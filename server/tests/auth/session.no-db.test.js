const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const express = require("express");
const request = require("supertest");

const { createApp } = require("../../app");
const authService = require("../../services/authService");
const User = require("../../models/User");
const authorize = require("../../middleware/authorize");
const { readConfig } = require("../../config/env");
const { hashPassword } = require("../../services/passwordService");
const { signAuthToken, verifyAuthToken } = require("../../services/jwtService");
const { clearAuthCookie, setAuthCookie } = require("../../utils/authCookie");

function createTestApp() {
  return createApp({
    rateLimiters: {
      login: [
        (req, res, next) => {
          res.set("X-Login-IP-Limiter", "active");
          next();
        },
      ],
      register: [],
      resendVerification: [],
      forgotPassword: [],
    },
  });
}

test("login normalizes its identifier and returns a safe user with an eight-hour cookie", async () => {
  const originalLogin = authService.login;
  let receivedInput;
  authService.login = async (input) => {
    receivedInput = input;
    return {
      id: "507f1f77bcf86cd799439011",
      username: "durai_01",
      email: "durai@example.com",
      mobile: "9876543210",
      address: "Chennai",
      role: "customer",
      isEmailVerified: true,
      isActive: true,
      passwordHash: "must-not-leak",
      tokenVersion: 3,
    };
  };

  try {
    const response = await request(createTestApp())
      .post("/api/auth/login")
      .set("Origin", "http://localhost:5173")
      .send({ identifier: " DURAI@EXAMPLE.COM ", password: "StrongPass1" });

    assert.equal(response.status, 200);
    assert.deepEqual(receivedInput, {
      identifier: "durai@example.com",
      password: "StrongPass1",
    });
    assert.equal(response.headers["x-login-ip-limiter"], "active");
    assert.equal(Object.hasOwn(response.body, "token"), false);
    assert.equal(Object.hasOwn(response.body.user, "passwordHash"), false);
    assert.equal(Object.hasOwn(response.body.user, "tokenVersion"), false);
    const cookie = response.headers["set-cookie"][0];
    assert.match(cookie, /^vsb_auth=/);
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
    assert.match(cookie, /Max-Age=28800/i);
    assert.doesNotMatch(cookie, /Secure/i);

    const encoded = cookie.match(/^vsb_auth=([^;]+)/)[1];
    const payload = jwt.decode(encoded);
    assert.deepEqual(Object.keys(payload).sort(), ["aud", "exp", "iat", "iss", "sub", "ver"]);
    assert.equal(payload.sub, "507f1f77bcf86cd799439011");
    assert.equal(payload.ver, 3);
    assert.equal(payload.exp - payload.iat, 8 * 60 * 60);
  } finally {
    authService.login = originalLogin;
  }
});

test("login validation rejects incomplete or unknown credentials before the service", async () => {
  const originalLogin = authService.login;
  let serviceCalls = 0;
  authService.login = async () => {
    serviceCalls += 1;
  };

  try {
    const missing = await request(createTestApp())
      .post("/api/auth/login")
      .send({ identifier: "durai@example.com" });
    const unknown = await request(createTestApp())
      .post("/api/auth/login")
      .send({ identifier: "durai@example.com", password: "StrongPass1", role: "admin" });

    assert.equal(missing.status, 400);
    assert.deepEqual(missing.body, {
      message: "Validation failed",
      errors: [{ field: "password", message: "Password must be text" }],
    });
    assert.equal(unknown.status, 400);
    assert.deepEqual(unknown.body, {
      message: "Request contains unknown fields",
      errors: [{ field: "role", message: "This field is not allowed" }],
    });
    assert.equal(serviceCalls, 0);
  } finally {
    authService.login = originalLogin;
  }
});

test("login service uses a neutral invalid-credentials error and rejects unavailable accounts", async () => {
  const originalFindOne = User.findOne;
  const passwordHash = await hashPassword("StrongPass1");
  const user = {
    id: "507f1f77bcf86cd799439011",
    email: "durai@example.com",
    username: "durai_01",
    passwordHash,
    tokenVersion: 0,
    isActive: true,
    isEmailVerified: true,
  };
  User.findOne = () => ({ select: async () => user });

  try {
    await assert.rejects(
      () => authService.login({ identifier: "durai@example.com", password: "WrongPass1" }),
      { statusCode: 401, message: "Incorrect email, username, or password" },
    );

    user.isEmailVerified = false;
    await assert.rejects(
      () => authService.login({ identifier: "durai@example.com", password: "StrongPass1" }),
      { statusCode: 403, message: "Email verification is required" },
    );

    user.isEmailVerified = true;
    user.isActive = false;
    await assert.rejects(
      () => authService.login({ identifier: "durai@example.com", password: "StrongPass1" }),
      { statusCode: 403, message: "Account is inactive" },
    );
  } finally {
    User.findOne = originalFindOne;
  }
});

test("login performs a cost-12 bcrypt comparison for a missing user and keeps the credential error identical", async () => {
  const originalFindOne = User.findOne;
  const originalCompare = bcrypt.compare;
  const knownPasswordHash = await hashPassword("StrongPass1");
  const comparisons = [];
  bcrypt.compare = async (password, passwordHash) => {
    comparisons.push({ password, passwordHash });
    return originalCompare(password, passwordHash);
  };

  try {
    User.findOne = () => ({ select: async () => null });
    let missingUserError;
    try {
      await authService.login({
        identifier: "missing@example.com",
        password: "WrongPass1",
      });
    } catch (error) {
      missingUserError = error;
    }

    assert.equal(comparisons.length, 1);
    assert.equal(comparisons[0].password, "WrongPass1");
    assert.equal(bcrypt.getRounds(comparisons[0].passwordHash), 12);

    User.findOne = () => ({
      select: async () => ({
        passwordHash: knownPasswordHash,
        tokenVersion: 0,
        isActive: true,
        isEmailVerified: true,
      }),
    });
    let wrongPasswordError;
    try {
      await authService.login({
        identifier: "known@example.com",
        password: "WrongPass1",
      });
    } catch (error) {
      wrongPasswordError = error;
    }

    assert.deepEqual(
      {
        statusCode: missingUserError.statusCode,
        message: missingUserError.message,
      },
      {
        statusCode: wrongPasswordError.statusCode,
        message: wrongPasswordError.message,
      },
    );
    assert.deepEqual(
      {
        statusCode: missingUserError.statusCode,
        message: missingUserError.message,
      },
      {
        statusCode: 401,
        message: "Incorrect email, username, or password",
      },
    );
  } finally {
    User.findOne = originalFindOne;
    bcrypt.compare = originalCompare;
  }
});

test("JWT verification enforces the minimal payload, issuer, audience, and eight-hour expiry", () => {
  const token = signAuthToken({ id: "507f1f77bcf86cd799439011", tokenVersion: 4 });
  const decoded = jwt.decode(token);
  assert.deepEqual(Object.keys(decoded).sort(), ["aud", "exp", "iat", "iss", "sub", "ver"]);
  assert.equal(decoded.exp - decoded.iat, 8 * 60 * 60);
  assert.deepEqual(verifyAuthToken(token).sub, "507f1f77bcf86cd799439011");

  const wrongIssuer = jwt.sign(
    { sub: "507f1f77bcf86cd799439011", ver: 4 },
    readConfig().jwtSecret,
    { expiresIn: "8h", issuer: "another-issuer", audience: "vehicle-service-booking-web" },
  );
  assert.throws(() => verifyAuthToken(wrongIssuer), /jwt issuer invalid/);
});

test("cookie helpers use the same scoped cookie contract when setting and clearing", async () => {
  const probe = express();
  probe.get("/set", (req, res) => {
    setAuthCookie(res, "test-token");
    res.json({ ok: true });
  });
  probe.post("/clear", (req, res) => {
    clearAuthCookie(res);
    res.json({ ok: true });
  });

  const set = await request(probe).get("/set");
  const clear = await request(probe).post("/clear");
  assert.match(set.headers["set-cookie"][0], /^vsb_auth=test-token;/);
  assert.match(set.headers["set-cookie"][0], /HttpOnly/i);
  assert.match(set.headers["set-cookie"][0], /SameSite=Lax/i);
  assert.match(set.headers["set-cookie"][0], /Path=\//i);
  assert.match(set.headers["set-cookie"][0], /Max-Age=28800/i);
  assert.doesNotMatch(set.headers["set-cookie"][0], /Secure/i);
  assert.match(clear.headers["set-cookie"][0], /^vsb_auth=;/);
  assert.match(clear.headers["set-cookie"][0], /HttpOnly/i);
  assert.match(clear.headers["set-cookie"][0], /SameSite=Lax/i);
  assert.match(clear.headers["set-cookie"][0], /Path=\//i);
  assert.doesNotMatch(clear.headers["set-cookie"][0], /Secure/i);
});

test("production cookie helpers add Secure", async () => {
  const originalMode = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  const probe = express();
  probe.get("/set", (req, res) => {
    setAuthCookie(res, "test-token");
    res.json({ ok: true });
  });

  try {
    const response = await request(probe).get("/set");
    assert.match(response.headers["set-cookie"][0], /Secure/i);
  } finally {
    process.env.NODE_ENV = originalMode;
  }
});

test("authentication reloads the account and current user endpoint never returns tokenVersion", async () => {
  const originalFindById = User.findById;
  const user = {
    id: "507f1f77bcf86cd799439011",
    username: "durai_01",
    email: "durai@example.com",
    mobile: "9876543210",
    address: "Chennai",
    role: "customer",
    tokenVersion: 2,
    isActive: true,
    isEmailVerified: true,
  };
  let foundId;
  User.findById = (id) => ({
    select: async () => {
      foundId = id;
      return user;
    },
  });

  try {
    const app = createTestApp();
    const token = signAuthToken(user);
    const current = await request(app).get("/api/auth/me").set("Cookie", `vsb_auth=${token}`);
    assert.equal(current.status, 200);
    assert.equal(foundId, user.id);
    assert.equal(current.body.user.role, "customer");
    assert.equal(Object.hasOwn(current.body.user, "tokenVersion"), false);

    user.tokenVersion = 3;
    const stale = await request(app).get("/api/auth/me").set("Cookie", `vsb_auth=${token}`);
    assert.equal(stale.status, 401);
    assert.deepEqual(stale.body, { message: "Authentication is invalid or expired" });

    const currentToken = signAuthToken(user);
    user.isActive = false;
    const inactive = await request(app)
      .get("/api/auth/me")
      .set("Cookie", `vsb_auth=${currentToken}`);
    assert.equal(inactive.status, 403);
    assert.deepEqual(inactive.body, { message: "Account is inactive" });

    user.isActive = true;
    user.isEmailVerified = false;
    const unverified = await request(app)
      .get("/api/auth/me")
      .set("Cookie", `vsb_auth=${currentToken}`);
    assert.equal(unverified.status, 403);
    assert.deepEqual(unverified.body, { message: "Email verification is required" });
  } finally {
    User.findById = originalFindById;
  }
});

test("authentication rejects missing and malformed cookies before authorization", async () => {
  const app = createTestApp();
  const missing = await request(app).get("/api/auth/me");
  const malformed = await request(app).get("/api/auth/me").set("Cookie", "vsb_auth=bad");
  assert.equal(missing.status, 401);
  assert.deepEqual(missing.body, { message: "Authentication required" });
  assert.equal(malformed.status, 401);
  assert.deepEqual(malformed.body, { message: "Authentication is invalid or expired" });
});

test("authorization allows only an authenticated user with an allowed current role", async () => {
  const probe = express();
  probe.get("/admin", (req, res, next) => {
    req.user = { role: "customer" };
    next();
  }, authorize("admin"), (req, res) => res.json({ ok: true }));
  probe.get("/operator", (req, res, next) => {
    req.user = { role: "admin" };
    next();
  }, authorize("admin"), (req, res) => res.json({ ok: true }));
  probe.use((error, req, res, next) => {
    res.status(error.statusCode || 500).json({ message: error.message });
  });

  const denied = await request(probe).get("/admin");
  const allowed = await request(probe).get("/operator");
  assert.equal(denied.status, 403);
  assert.deepEqual(denied.body, { message: "You do not have permission for this action" });
  assert.equal(allowed.status, 200);
  assert.deepEqual(allowed.body, { ok: true });
});

test("logout clears the authentication cookie without exposing a token", async () => {
  const response = await request(createTestApp())
    .post("/api/auth/logout")
    .set("Origin", "http://localhost:5173");

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { message: "Logout successful" });
  assert.match(response.headers["set-cookie"][0], /^vsb_auth=;/);
  assert.equal(Object.hasOwn(response.body, "token"), false);
});
