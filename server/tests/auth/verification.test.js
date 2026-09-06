const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../../app");
const User = require("../../models/User");
const emailService = require("../../services/emailService");
const { hashPassword } = require("../../services/passwordService");
const {
  connectTestDb,
  clearTestDb,
  disconnectTestDb,
} = require("../helpers/testDb");

let sentEmails;

function tokenFromEmail(message) {
  const match = message.text.match(/token=([a-f0-9]{64})/);
  assert.ok(match, "email must contain a 64-character token");
  return match[1];
}

async function createUnverifiedUser() {
  return User.create({
    username: "durai_01",
    email: "durai@example.com",
    mobile: "9876543210",
    address: "Chennai",
    passwordHash: await hashPassword("StrongPass1"),
    role: "customer",
    isEmailVerified: false,
  });
}

test.before(connectTestDb);
test.beforeEach(async () => {
  await clearTestDb();
  sentEmails = [];
  emailService.setTransporterForTests({
    async sendMail(message) {
      sentEmails.push(message);
      return { messageId: "verification-test" };
    },
  });
});
test.afterEach(emailService.resetTransporterForTests);
test.after(disconnectTestDb);

test("verification token verifies the account exactly once", async () => {
  const user = await createUnverifiedUser();
  await request(app)
    .post("/api/auth/resend-verification")
    .set("Origin", "http://localhost:5173")
    .send({ email: user.email });
  const token = tokenFromEmail(sentEmails[0]);

  const first = await request(app)
    .post("/api/auth/verify-email")
    .set("Origin", "http://localhost:5173")
    .send({ token });
  const second = await request(app)
    .post("/api/auth/verify-email")
    .set("Origin", "http://localhost:5173")
    .send({ token });

  assert.equal(first.status, 200);
  assert.equal(second.status, 400);
  assert.equal(second.body.message, "This link is invalid or expired");
  assert.equal((await User.findById(user._id)).isEmailVerified, true);
});

test("resend response is neutral for unknown, verified, and eligible email", async () => {
  const neutralMessage =
    "If the account can be verified, a new verification email has been sent.";
  const unknown = await request(app)
    .post("/api/auth/resend-verification")
    .set("Origin", "http://localhost:5173")
    .send({ email: "unknown@example.com" });

  const verifiedUser = await createUnverifiedUser();
  verifiedUser.isEmailVerified = true;
  await verifiedUser.save();
  const verified = await request(app)
    .post("/api/auth/resend-verification")
    .set("Origin", "http://localhost:5173")
    .send({ email: verifiedUser.email });

  verifiedUser.isEmailVerified = false;
  await verifiedUser.save();
  const eligible = await request(app)
    .post("/api/auth/resend-verification")
    .set("Origin", "http://localhost:5173")
    .send({ email: verifiedUser.email });

  assert.equal(unknown.body.message, neutralMessage);
  assert.equal(verified.body.message, neutralMessage);
  assert.equal(eligible.body.message, neutralMessage);
  assert.equal(sentEmails.length, 1);
});

test("explicit resend returns 502 when Gmail fails", async () => {
  const user = await createUnverifiedUser();
  emailService.setTransporterForTests({
    async sendMail() {
      throw new Error("test delivery failure");
    },
  });

  const response = await request(app)
    .post("/api/auth/resend-verification")
    .set("Origin", "http://localhost:5173")
    .send({ email: user.email });

  assert.equal(response.status, 502);
  assert.equal(response.body.message, "Verification email could not be sent");
});
