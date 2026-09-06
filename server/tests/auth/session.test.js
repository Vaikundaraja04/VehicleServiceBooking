const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const request = require("supertest");

const app = require("../../app");
const { readConfig } = require("../../config/env");
const User = require("../../models/User");
const { hashPassword } = require("../../services/passwordService");
const { setAuthCookie } = require("../../utils/authCookie");
const {
  connectTestDb,
  clearTestDb,
  disconnectTestDb,
} = require("../helpers/testDb");

async function createUser(overrides = {}) {
  return User.create({
    username: "durai_01",
    email: "durai@example.com",
    mobile: "9876543210",
    address: "Chennai",
    passwordHash: await hashPassword("StrongPass1"),
    role: "customer",
    isEmailVerified: true,
    isActive: true,
    ...overrides,
  });
}

test.before(connectTestDb);
test.beforeEach(clearTestDb);
test.after(disconnectTestDb);

test("login by email sets a safe eight-hour HttpOnly cookie with a minimal JWT", async () => {
  const user = await createUser();
  const response = await request(app)
    .post("/api/auth/login")
    .set("Origin", "http://localhost:5173")
    .send({ identifier: "DURAI@EXAMPLE.COM", password: "StrongPass1" });

  assert.equal(response.status, 200);
  const cookie = response.headers["set-cookie"][0];
  assert.match(cookie, /^vsb_auth=/);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
  assert.match(cookie, /Max-Age=28800/i);
  assert.doesNotMatch(cookie, /Secure/i);
  assert.equal(Object.hasOwn(response.body, "token"), false);

  const encoded = cookie.match(/^vsb_auth=([^;]+)/)[1];
  const payload = jwt.decode(encoded);
  assert.deepEqual(Object.keys(payload).sort(), ["aud", "exp", "iat", "iss", "sub", "ver"]);
  assert.equal(payload.sub, user.id);
});

test("login by username can read /me and logout clears the cookie", async () => {
  await createUser();
  const login = await request(app)
    .post("/api/auth/login")
    .set("Origin", "http://localhost:5173")
    .send({ identifier: "DURAI_01", password: "StrongPass1" });
  const cookie = login.headers["set-cookie"][0];

  const current = await request(app).get("/api/auth/me").set("Cookie", cookie);
  const logout = await request(app)
    .post("/api/auth/logout")
    .set("Origin", "http://localhost:5173")
    .set("Cookie", cookie);

  assert.equal(current.status, 200);
  assert.equal(current.body.user.email, "durai@example.com");
  assert.equal(Object.hasOwn(current.body.user, "tokenVersion"), false);
  assert.equal(logout.status, 200);
  assert.match(logout.headers["set-cookie"][0], /^vsb_auth=;/);
});

test("production cookie adds the Secure attribute", async () => {
  const originalMode = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const probe = express();
    probe.get("/cookie", (req, res) => {
      setAuthCookie(res, "test-token");
      res.json({ ok: true });
    });
    const response = await request(probe).get("/cookie");
    assert.match(response.headers["set-cookie"][0], /Secure/i);
  } finally {
    process.env.NODE_ENV = originalMode;
  }
});

test("login rejects generic bad credentials and specific unavailable accounts", async () => {
  await createUser();
  const bad = await request(app)
    .post("/api/auth/login")
    .set("Origin", "http://localhost:5173")
    .send({ identifier: "durai@example.com", password: "WrongPass1" });

  await User.updateOne({ email: "durai@example.com" }, { isEmailVerified: false });
  const unverified = await request(app)
    .post("/api/auth/login")
    .set("Origin", "http://localhost:5173")
    .send({ identifier: "durai@example.com", password: "StrongPass1" });

  await User.updateOne(
    { email: "durai@example.com" },
    { isEmailVerified: true, isActive: false },
  );
  const inactive = await request(app)
    .post("/api/auth/login")
    .set("Origin", "http://localhost:5173")
    .send({ identifier: "durai@example.com", password: "StrongPass1" });

  assert.equal(bad.status, 401);
  assert.equal(bad.body.message, "Incorrect email, username, or password");
  assert.equal(unverified.status, 403);
  assert.equal(inactive.status, 403);
});

test("/me rejects missing, malformed, and stale authentication", async () => {
  const user = await createUser();
  const missing = await request(app).get("/api/auth/me");
  const malformed = await request(app).get("/api/auth/me").set("Cookie", "vsb_auth=bad");

  const login = await request(app)
    .post("/api/auth/login")
    .set("Origin", "http://localhost:5173")
    .send({ identifier: user.email, password: "StrongPass1" });
  await User.updateOne({ _id: user._id }, { $inc: { tokenVersion: 1 } });
  const stale = await request(app)
    .get("/api/auth/me")
    .set("Cookie", login.headers["set-cookie"][0]);

  assert.equal(missing.status, 401);
  assert.equal(malformed.status, 401);
  assert.equal(stale.status, 401);
});

test("/me reloads account state and rejects expired, inactive, and unverified access", async () => {
  const user = await createUser();
  const config = readConfig();
  const expiredToken = jwt.sign(
    { sub: user.id, ver: 0 },
    config.jwtSecret,
    {
      expiresIn: -1,
      issuer: "vehicle-service-booking",
      audience: "vehicle-service-booking-web",
    },
  );
  const expired = await request(app)
    .get("/api/auth/me")
    .set("Cookie", `vsb_auth=${expiredToken}`);

  const login = await request(app)
    .post("/api/auth/login")
    .set("Origin", "http://localhost:5173")
    .send({ identifier: user.email, password: "StrongPass1" });
  const cookie = login.headers["set-cookie"][0];

  await User.updateOne({ _id: user._id }, { isActive: false });
  const inactive = await request(app).get("/api/auth/me").set("Cookie", cookie);
  await User.updateOne(
    { _id: user._id },
    { isActive: true, isEmailVerified: false },
  );
  const unverified = await request(app).get("/api/auth/me").set("Cookie", cookie);

  assert.equal(expired.status, 401);
  assert.equal(inactive.status, 403);
  assert.equal(unverified.status, 403);
});
