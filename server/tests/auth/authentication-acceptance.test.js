const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../../app");
const emailService = require("../../services/emailService");
const {
  connectTestDb,
  clearTestDb,
  disconnectTestDb,
} = require("../helpers/testDb");

test.before(connectTestDb);
test.beforeEach(clearTestDb);
test.afterEach(emailService.resetTransporterForTests);
test.after(disconnectTestDb);

test("customer registers, verifies, logs in, reads profile, and logs out", async () => {
  const sent = [];
  emailService.setTransporterForTests({
    async sendMail(message) {
      sent.push(message);
      return { messageId: "acceptance-test" };
    },
  });

  const registration = await request(app)
    .post("/api/auth/register")
    .set("Origin", "http://localhost:5173")
    .send({
      username: "journey_user",
      email: "journey@example.com",
      mobile: "9876543210",
      address: "Chennai",
      password: "JourneyPass1",
    });
  assert.equal(registration.status, 201);

  const blockedLogin = await request(app)
    .post("/api/auth/login")
    .set("Origin", "http://localhost:5173")
    .send({ identifier: "journey@example.com", password: "JourneyPass1" });
  assert.equal(blockedLogin.status, 403);

  const verificationToken = sent[0].text.match(/token=([a-f0-9]{64})/)[1];
  const verification = await request(app)
    .post("/api/auth/verify-email")
    .set("Origin", "http://localhost:5173")
    .send({ token: verificationToken });
  assert.equal(verification.status, 200);

  const login = await request(app)
    .post("/api/auth/login")
    .set("Origin", "http://localhost:5173")
    .send({ identifier: "journey_user", password: "JourneyPass1" });
  assert.equal(login.status, 200);
  const cookie = login.headers["set-cookie"][0];

  const current = await request(app).get("/api/auth/me").set("Cookie", cookie);
  assert.equal(current.status, 200);
  assert.equal(current.body.user.email, "journey@example.com");

  const logout = await request(app)
    .post("/api/auth/logout")
    .set("Origin", "http://localhost:5173")
    .set("Cookie", cookie);
  assert.equal(logout.status, 200);
  const clearedCookie = logout.headers["set-cookie"]?.some((header) =>
    header.startsWith("vsb_auth=;"),
  );
  assert.equal(clearedCookie, true, "logout must clear the authentication cookie");
});
