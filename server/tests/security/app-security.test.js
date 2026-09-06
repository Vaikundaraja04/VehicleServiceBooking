const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");

const appModule = require("../../app");
const { createApp } = appModule;
const { readConfig } = require("../../config/env");
const errorHandler = require("../../middleware/errorHandler");
const { createAuthRateLimiters } = require("../../middleware/rateLimiters");
const authService = require("../../services/authService");

function createLoginProbe(trustedProxyIps = "") {
  const config = readConfig({
    ...process.env,
    TRUSTED_PROXY_IPS: trustedProxyIps,
  });
  return createApp({
    config,
    rateLimiters: {
      login: createAuthRateLimiters({ loginMax: 2 }).login,
    },
  });
}

test("health response has security and exact-origin CORS headers", async () => {
  const response = await request(appModule)
    .get("/api/health")
    .set("Origin", "http://localhost:5173");

  assert.equal(response.status, 200);
  assert.equal(response.headers["access-control-allow-origin"], "http://localhost:5173");
  assert.equal(response.headers["access-control-allow-credentials"], "true");
  assert.ok(response.headers["x-content-type-options"]);
});

test("unsafe request from another origin returns the central error shape", async () => {
  const response = await request(appModule)
    .post("/api/not-present")
    .set("Origin", "https://evil.example")
    .send({ value: true });

  assert.equal(response.status, 403);
  assert.deepEqual(response.body, { message: "Request origin is not allowed" });
  assert.equal(Object.hasOwn(response.body, "stack"), false);
});

test("foreign-origin malformed JSON is rejected by the origin guard before parsing", async () => {
  const response = await request(appModule)
    .post("/api/not-present")
    .set("Origin", "https://evil.example")
    .set("Content-Type", "application/json")
    .send('{"value":');

  assert.equal(response.status, 403);
  assert.deepEqual(response.body, { message: "Request origin is not allowed" });
});

function jsonBodyWithByteLength(byteLength) {
  const emptyBody = '{"value":""}';
  const body = `{"value":"${"x".repeat(byteLength - Buffer.byteLength(emptyBody))}"}`;
  assert.equal(Buffer.byteLength(body), byteLength);
  return body;
}

test("default routes retain the 20 KB JSON ceiling", async () => {
  const missing = await request(appModule).get("/api/not-present");
  assert.equal(missing.status, 404);
  assert.deepEqual(missing.body, { message: "Route not found" });

  const withinLimit = await request(appModule)
    .post("/api/not-present")
    .set("Origin", "http://localhost:5173")
    .set("Content-Type", "application/json")
    .send(jsonBodyWithByteLength((20 * 1024) - 1));
  assert.equal(withinLimit.status, 404);
  assert.deepEqual(withinLimit.body, { message: "Route not found" });

  const oversized = await request(appModule)
    .post("/api/not-present")
    .set("Origin", "http://localhost:5173")
    .set("Content-Type", "application/json")
    .send(jsonBodyWithByteLength((20 * 1024) + 1));
  assert.equal(oversized.status, 413);
  assert.deepEqual(oversized.body, { message: "JSON body cannot exceed 20 KB" });
});

test("only the schedule replacement route has a bounded 30 KB JSON ceiling", async () => {
  const withinLimit = await request(appModule)
    .patch("/api/admin/workshop-schedule")
    .set("Origin", "http://localhost:5173")
    .set("Content-Type", "application/json")
    .send(jsonBodyWithByteLength((30 * 1024) - 1));
  assert.equal(withinLimit.status, 401);
  assert.deepEqual(withinLimit.body, { message: "Authentication required" });

  const oversized = await request(appModule)
    .patch("/api/admin/workshop-schedule")
    .set("Origin", "http://localhost:5173")
    .set("Content-Type", "application/json")
    .send(jsonBodyWithByteLength((30 * 1024) + 1));
  assert.equal(oversized.status, 413);
  assert.deepEqual(oversized.body, { message: "JSON body cannot exceed 30 KB" });
});

test("database duplicate-key errors become safe 409 field errors without a stack", async () => {
  const probe = express();
  probe.get("/duplicate", (req, res, next) => {
    const error = new Error("database details must not escape");
    error.code = 11000;
    error.keyPattern = { email: 1 };
    next(error);
  });
  probe.use(errorHandler);

  const response = await request(probe).get("/duplicate");
  assert.equal(response.status, 409);
  assert.deepEqual(response.body, {
    message: "email already exists",
    errors: [{ field: "email", message: "email already exists" }],
  });
  assert.equal(Object.hasOwn(response.body, "stack"), false);
});

test("an isolated limiter returns 429 after its configured maximum", async () => {
  const limiter = createAuthRateLimiters({ loginMax: 2 }).login;
  const probe = express();
  probe.set("trust proxy", 1);
  probe.post("/probe", express.json(), limiter, (req, res) => res.json({ ok: true }));

  assert.equal((await request(probe).post("/probe").send({ identifier: "a" })).status, 200);
  assert.equal((await request(probe).post("/probe").send({ identifier: "a" })).status, 200);
  const limited = await request(probe).post("/probe").send({ identifier: "a" });
  assert.equal(limited.status, 429);
  assert.deepEqual(limited.body, { message: "Too many login attempts. Try again later." });
});

test("direct callers cannot rotate X-Forwarded-For to bypass the login IP limit", async () => {
  const originalLogin = authService.login;
  authService.login = async () => ({
    id: "507f1f77bcf86cd799439011",
    tokenVersion: 0,
    isActive: true,
    isEmailVerified: true,
  });

  try {
    const app = createLoginProbe();
    for (const forwardedIp of ["203.0.113.40", "203.0.113.41"]) {
      const response = await request(app)
        .post("/api/auth/login")
        .set("X-Forwarded-For", forwardedIp)
        .send({ identifier: "user@example.com", password: "StrongPass1" });
      assert.equal(response.status, 200);
    }

    const limited = await request(app)
      .post("/api/auth/login")
      .set("X-Forwarded-For", "203.0.113.42")
      .send({ identifier: "user@example.com", password: "StrongPass1" });

    assert.equal(limited.status, 429);
    assert.deepEqual(limited.body, {
      message: "Too many login attempts. Try again later.",
    });
  } finally {
    authService.login = originalLogin;
  }
});

test("an explicitly allowlisted proxy supplies the client IP to the login limiter", async () => {
  const originalLogin = authService.login;
  authService.login = async () => ({
    id: "507f1f77bcf86cd799439011",
    tokenVersion: 0,
    isActive: true,
    isEmailVerified: true,
  });

  try {
    const app = createLoginProbe("loopback");
    for (const forwardedIp of ["203.0.113.50", "203.0.113.51", "203.0.113.52"]) {
      const response = await request(app)
        .post("/api/auth/login")
        .set("X-Forwarded-For", forwardedIp)
        .send({ identifier: "user@example.com", password: "StrongPass1" });
      assert.equal(response.status, 200);
    }
  } finally {
    authService.login = originalLogin;
  }
});

test("login limit survives identifier rotation from one IP", async () => {
  const limiter = createAuthRateLimiters({ loginMax: 2 }).login;
  const probe = express();
  probe.set("trust proxy", 1);
  probe.post("/probe", express.json(), limiter, (req, res) => res.json({ ok: true }));

  assert.equal(
    (await request(probe).post("/probe").set("X-Forwarded-For", "203.0.113.10").send({ identifier: "a" })).status,
    200,
  );
  assert.equal(
    (await request(probe).post("/probe").set("X-Forwarded-For", "203.0.113.10").send({ identifier: "b" })).status,
    200,
  );
  const limited = await request(probe)
    .post("/probe")
    .set("X-Forwarded-For", "203.0.113.10")
    .send({ identifier: "c" });

  assert.equal(limited.status, 429);
  assert.deepEqual(limited.body, { message: "Too many login attempts. Try again later." });
});

test("account-flow limits survive IP and account rotation independently", async () => {
  const accountLimiter = createAuthRateLimiters({ registerMax: 2 }).register;
  const accountProbe = express();
  accountProbe.set("trust proxy", 1);
  accountProbe.post("/probe", express.json(), accountLimiter, (req, res) => res.json({ ok: true }));

  assert.equal(
    (await request(accountProbe)
      .post("/probe")
      .set("X-Forwarded-For", "203.0.113.11")
      .send({ email: "USER@example.com" })).status,
    200,
  );
  assert.equal(
    (await request(accountProbe)
      .post("/probe")
      .set("X-Forwarded-For", "203.0.113.12")
      .send({ email: "user@example.com" })).status,
    200,
  );
  const accountLimited = await request(accountProbe)
    .post("/probe")
    .set("X-Forwarded-For", "203.0.113.13")
    .send({ email: "user@example.com" });

  assert.equal(accountLimited.status, 429);
  assert.deepEqual(accountLimited.body, { message: "Too many registration attempts. Try again later." });

  const ipLimiter = createAuthRateLimiters({ registerMax: 2 }).register;
  const ipProbe = express();
  ipProbe.set("trust proxy", 1);
  ipProbe.post("/probe", express.json(), ipLimiter, (req, res) => res.json({ ok: true }));

  assert.equal(
    (await request(ipProbe)
      .post("/probe")
      .set("X-Forwarded-For", "203.0.113.14")
      .send({ email: "first@example.com" })).status,
    200,
  );
  assert.equal(
    (await request(ipProbe)
      .post("/probe")
      .set("X-Forwarded-For", "203.0.113.14")
      .send({ email: "second@example.com" })).status,
    200,
  );
  const ipLimited = await request(ipProbe)
    .post("/probe")
    .set("X-Forwarded-For", "203.0.113.14")
    .send({ email: "third@example.com" });

  assert.equal(ipLimited.status, 429);
  assert.deepEqual(ipLimited.body, { message: "Too many registration attempts. Try again later." });
});

test("administrator invitation account limit survives recipient and IP rotation", async () => {
  const invitationLimiters = createAuthRateLimiters({ invitationMax: 2 }).adminInvitation;
  const probe = express();
  probe.set("trust proxy", 1);
  probe.post(
    "/probe",
    express.json(),
    (req, res, next) => {
      req.user = { _id: req.get("X-Admin-Id") };
      next();
    },
    invitationLimiters,
    (req, res) => res.json({ ok: true }),
  );

  assert.equal(
    (await request(probe)
      .post("/probe")
      .set("X-Admin-Id", "admin-a")
      .set("X-Forwarded-For", "203.0.113.21")
      .send({ email: "first@example.com" })).status,
    200,
  );
  assert.equal(
    (await request(probe)
      .post("/probe")
      .set("X-Admin-Id", "admin-a")
      .set("X-Forwarded-For", "203.0.113.22")
      .send({ email: "second@example.com" })).status,
    200,
  );
  const limited = await request(probe)
    .post("/probe")
    .set("X-Admin-Id", "admin-a")
    .set("X-Forwarded-For", "203.0.113.23")
    .send({ email: "third@example.com" });

  assert.equal(limited.status, 429);
  assert.deepEqual(limited.body, { message: "Too many invitation requests. Try again later." });
});

test("administrator invitation account limits are isolated between inviters", async () => {
  const invitationLimiters = createAuthRateLimiters({ invitationMax: 2 }).adminInvitation;
  const probe = express();
  probe.set("trust proxy", 1);
  probe.post(
    "/probe",
    express.json(),
    (req, res, next) => {
      req.user = { id: req.get("X-Admin-Id") };
      next();
    },
    invitationLimiters,
    (req, res) => res.json({ ok: true }),
  );

  for (const ip of ["203.0.113.31", "203.0.113.32"]) {
    const response = await request(probe)
      .post("/probe")
      .set("X-Admin-Id", "admin-a")
      .set("X-Forwarded-For", ip)
      .send({ email: "shared@example.com" });
    assert.equal(response.status, 200);
  }

  const otherAdmin = await request(probe)
    .post("/probe")
    .set("X-Admin-Id", "admin-b")
    .set("X-Forwarded-For", "203.0.113.33")
    .send({ email: "shared@example.com" });

  assert.equal(otherAdmin.status, 200);
});
