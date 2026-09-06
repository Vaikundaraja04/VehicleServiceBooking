const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../../app");
const User = require("../../models/User");
const emailService = require("../../services/emailService");
const {
  connectTestDb,
  clearTestDb,
  disconnectTestDb,
} = require("../helpers/testDb");

const validCustomer = {
  username: "durai_01",
  email: "durai@example.com",
  mobile: "9876543210",
  address: "Chennai",
  password: "StrongPass1",
};

let sentEmails;

test.before(connectTestDb);
test.beforeEach(async () => {
  await clearTestDb();
  sentEmails = [];
  emailService.setTransporterForTests({
    async sendMail(message) {
      sentEmails.push(message);
      return { messageId: "registration-test" };
    },
  });
});
test.afterEach(emailService.resetTransporterForTests);
test.after(disconnectTestDb);

test("POST /api/auth/register creates an unverified customer and sends a link", async () => {
  const response = await request(app)
    .post("/api/auth/register")
    .set("Origin", "http://localhost:5173")
    .send(validCustomer);

  assert.equal(response.status, 201);
  assert.equal(response.body.emailSent, true);
  assert.equal(response.body.user.role, "customer");
  assert.equal(response.body.user.isEmailVerified, false);
  assert.equal(Object.hasOwn(response.body.user, "passwordHash"), false);
  assert.equal(Object.hasOwn(response.body, "token"), false);
  assert.equal(sentEmails.length, 1);

  const stored = await User.findOne({ email: "durai@example.com" }).select("+passwordHash");
  assert.ok(stored.passwordHash.startsWith("$2"));
  assert.notEqual(stored.passwordHash, validCustomer.password);
});

test("registration rejects role and other unknown fields", async () => {
  const response = await request(app)
    .post("/api/auth/register")
    .set("Origin", "http://localhost:5173")
    .send({ ...validCustomer, role: "admin" });

  assert.equal(response.status, 400);
  assert.deepEqual(response.body.errors, [
    { field: "role", message: "This field is not allowed" },
  ]);
  assert.equal(await User.countDocuments(), 0);
});

test("registration returns a readable conflict for a duplicate email", async () => {
  await request(app)
    .post("/api/auth/register")
    .set("Origin", "http://localhost:5173")
    .send(validCustomer);

  const response = await request(app)
    .post("/api/auth/register")
    .set("Origin", "http://localhost:5173")
    .send({ ...validCustomer, username: "different_user" });

  assert.equal(response.status, 409);
  assert.equal(response.body.message, "Email already exists");
});

test("registration returns a readable conflict for a duplicate username", async () => {
  await request(app)
    .post("/api/auth/register")
    .set("Origin", "http://localhost:5173")
    .send(validCustomer);

  const response = await request(app)
    .post("/api/auth/register")
    .set("Origin", "http://localhost:5173")
    .send({ ...validCustomer, email: "different@example.com" });

  assert.equal(response.status, 409);
  assert.equal(response.body.message, "Username already exists");
});

test("registration keeps the unverified account when Gmail fails", async () => {
  emailService.setTransporterForTests({
    async sendMail() {
      throw new Error("test delivery failure");
    },
  });

  const response = await request(app)
    .post("/api/auth/register")
    .set("Origin", "http://localhost:5173")
    .send(validCustomer);

  assert.equal(response.status, 201);
  assert.equal(response.body.emailSent, false);
  assert.equal(await User.countDocuments({ isEmailVerified: false }), 1);
  assert.equal(JSON.stringify(response.body).includes("test delivery failure"), false);
});
