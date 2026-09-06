const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../../app");
const AuthToken = require("../../models/AuthToken");
const User = require("../../models/User");
const emailService = require("../../services/emailService");
const { comparePassword, hashPassword } = require("../../services/passwordService");
const { hashToken, TOKEN_TYPES } = require("../../services/tokenService");
const {
  connectTestDb,
  clearTestDb,
  disconnectTestDb,
} = require("../helpers/testDb");

let sentEmails;

function resetTokenFromEmail(message) {
  const match = message.text.match(/token=([a-f0-9]{64})/);
  assert.ok(match);
  return match[1];
}

async function createVerifiedUser() {
  return User.create({
    username: "durai_01",
    email: "durai@example.com",
    mobile: "9876543210",
    address: "Chennai",
    passwordHash: await hashPassword("StrongPass1"),
    role: "customer",
    isEmailVerified: true,
  });
}

test.before(connectTestDb);
test.beforeEach(async () => {
  await clearTestDb();
  sentEmails = [];
  emailService.setTransporterForTests({
    async sendMail(message) {
      sentEmails.push(message);
      return { messageId: "reset-test" };
    },
  });
});
test.afterEach(emailService.resetTransporterForTests);
test.after(disconnectTestDb);

test("forgot-password response does not reveal whether an account exists", async () => {
  await createVerifiedUser();
  const known = await request(app)
    .post("/api/auth/forgot-password")
    .set("Origin", "http://localhost:5173")
    .send({ email: "durai@example.com" });
  const unknown = await request(app)
    .post("/api/auth/forgot-password")
    .set("Origin", "http://localhost:5173")
    .send({ email: "unknown@example.com" });

  assert.equal(known.status, 200);
  assert.deepEqual(known.body, unknown.body);
  assert.equal(sentEmails.length, 1);
});

test("concurrent forgot-password requests stay neutral and keep at most one current reset token", async () => {
  const user = await createVerifiedUser();
  const [first, second] = await Promise.all([
    request(app)
      .post("/api/auth/forgot-password")
      .set("Origin", "http://localhost:5173")
      .send({ email: user.email }),
    request(app)
      .post("/api/auth/forgot-password")
      .set("Origin", "http://localhost:5173")
      .send({ email: user.email }),
  ]);

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.deepEqual(first.body, second.body);
  const records = await AuthToken.find({ userId: user._id, type: TOKEN_TYPES.PASSWORD_RESET });
  assert.ok(records.length <= 1);
});

test("reset token works once, changes the hash, and invalidates the old JWT", async () => {
  const user = await createVerifiedUser();
  const login = await request(app)
    .post("/api/auth/login")
    .set("Origin", "http://localhost:5173")
    .send({ identifier: user.email, password: "StrongPass1" });

  await request(app)
    .post("/api/auth/forgot-password")
    .set("Origin", "http://localhost:5173")
    .send({ email: user.email });
  const token = resetTokenFromEmail(sentEmails[0]);

  const reset = await request(app)
    .post("/api/auth/reset-password")
    .set("Origin", "http://localhost:5173")
    .send({ token, newPassword: "NewStrong2" });
  const reused = await request(app)
    .post("/api/auth/reset-password")
    .set("Origin", "http://localhost:5173")
    .send({ token, newPassword: "AnotherStrong3" });
  const stale = await request(app)
    .get("/api/auth/me")
    .set("Cookie", login.headers["set-cookie"][0]);

  const updated = await User.findById(user._id).select("+passwordHash +tokenVersion");
  assert.equal(reset.status, 200);
  assert.match(reset.headers["set-cookie"][0], /^vsb_auth=;/);
  assert.equal(reused.status, 400);
  assert.equal(stale.status, 401);
  assert.equal(updated.tokenVersion, 1);
  assert.equal(await comparePassword("NewStrong2", updated.passwordHash), true);
});

test("forgot-password remains neutral when injected email delivery fails", async () => {
  await createVerifiedUser();
  emailService.setTransporterForTests({
    async sendMail() {
      throw new Error("test delivery failure");
    },
  });

  const response = await request(app)
    .post("/api/auth/forgot-password")
    .set("Origin", "http://localhost:5173")
    .send({ email: "durai@example.com" });

  assert.equal(response.status, 200);
  assert.equal(JSON.stringify(response.body).includes("failure"), false);
});

test("an expired reset token returns the same safe link error", async () => {
  const user = await createVerifiedUser();
  const rawToken = "c".repeat(64);
  await AuthToken.create({
    userId: user._id,
    type: TOKEN_TYPES.PASSWORD_RESET,
    tokenHash: hashToken(rawToken),
    tokenVersion: user.tokenVersion,
    expiresAt: new Date(Date.now() - 1000),
  });

  const response = await request(app)
    .post("/api/auth/reset-password")
    .set("Origin", "http://localhost:5173")
    .send({ token: rawToken, newPassword: "NewStrong2" });

  assert.equal(response.status, 400);
  assert.equal(response.body.message, "This link is invalid or expired");
});

test("a reset token issued for an older password version is unusable", async () => {
  const user = await createVerifiedUser();
  await request(app)
    .post("/api/auth/forgot-password")
    .set("Origin", "http://localhost:5173")
    .send({ email: user.email });
  const token = resetTokenFromEmail(sentEmails[0]);
  await User.updateOne({ _id: user._id }, { $inc: { tokenVersion: 1 } });

  const response = await request(app)
    .post("/api/auth/reset-password")
    .set("Origin", "http://localhost:5173")
    .send({ token, newPassword: "NewStrong2" });

  const unchanged = await User.findById(user._id).select("+passwordHash +tokenVersion");
  assert.equal(response.status, 400);
  assert.equal(response.body.message, "This link is invalid or expired");
  assert.equal(unchanged.tokenVersion, 1);
  assert.equal(await comparePassword("StrongPass1", unchanged.passwordHash), true);
});
