const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const { createApp } = require("../../app");
const authService = require("../../services/authService");
const User = require("../../models/User");
const tokenService = require("../../services/tokenService");

function createTestApp() {
  return createApp({
    rateLimiters: {
      login: [],
      register: [],
      resendVerification: [],
      forgotPassword: [
        (req, res, next) => {
          res.set("X-Recovery-IP-Limiter", "active");
          next();
        },
        (req, res, next) => {
          res.set("X-Recovery-Account-Limiter", "active");
          next();
        },
      ],
    },
  });
}

test("forgot-password normalizes email, uses both recovery limiters, and returns only the neutral response", async () => {
  const originalForgotPassword = authService.forgotPassword;
  let receivedEmail;
  authService.forgotPassword = async (email) => {
    receivedEmail = email;
    return {
      message: "If an eligible account exists, a password reset email has been sent.",
    };
  };

  try {
    const response = await request(createTestApp())
      .post("/api/auth/forgot-password")
      .send({ email: " DURAI@EXAMPLE.COM " });

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
      message: "If an eligible account exists, a password reset email has been sent.",
    });
    assert.equal(receivedEmail, "durai@example.com");
    assert.equal(response.headers["x-recovery-ip-limiter"], "active");
    assert.equal(response.headers["x-recovery-account-limiter"], "active");
  } finally {
    authService.forgotPassword = originalForgotPassword;
  }
});

test("reset-password rejects malformed links and bcrypt-unsafe passwords before the service", async () => {
  const originalResetPassword = authService.resetPassword;
  let serviceCalls = 0;
  authService.resetPassword = async () => {
    serviceCalls += 1;
  };

  try {
    const malformed = await request(createTestApp())
      .post("/api/auth/reset-password")
      .send({ token: "not-a-token", newPassword: "NewStrong2" });
    const tooManyBytes = await request(createTestApp())
      .post("/api/auth/reset-password")
      .send({ token: "a".repeat(64), newPassword: "A".repeat(68) + "a1😀" });

    assert.equal(malformed.status, 400);
    assert.deepEqual(malformed.body, {
      message: "Validation failed",
      errors: [
        {
          field: "token",
          message: "Token must contain 64 lowercase hexadecimal characters",
        },
      ],
    });
    assert.equal(tooManyBytes.status, 400);
    assert.deepEqual(tooManyBytes.body, {
      message: "Validation failed",
      errors: [
        {
          field: "newPassword",
          message: "Password must be at most 72 UTF-8 bytes long",
        },
      ],
    });
    assert.equal(serviceCalls, 0);
  } finally {
    authService.resetPassword = originalResetPassword;
  }
});

test("reset-password clears the scoped authentication cookie without returning secrets", async () => {
  const originalResetPassword = authService.resetPassword;
  let receivedInput;
  authService.resetPassword = async (input) => {
    receivedInput = input;
  };

  try {
    const response = await request(createTestApp())
      .post("/api/auth/reset-password")
      .send({ token: "b".repeat(64), newPassword: "NewStrong2" });

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
      message: "Password reset successful. Log in again.",
    });
    assert.deepEqual(receivedInput, { token: "b".repeat(64), newPassword: "NewStrong2" });
    assert.match(response.headers["set-cookie"][0], /^vsb_auth=;/);
    assert.match(response.headers["set-cookie"][0], /HttpOnly/i);
    assert.match(response.headers["set-cookie"][0], /SameSite=Lax/i);
    assert.match(response.headers["set-cookie"][0], /Path=\//i);
    assert.equal(Object.hasOwn(response.body, "token"), false);
    assert.equal(Object.hasOwn(response.body, "password"), false);
    assert.doesNotMatch(JSON.stringify(response.body), /NewStrong2|b{64}/);
  } finally {
    authService.resetPassword = originalResetPassword;
  }
});

test("forgot-password stays neutral when token issuance fails for an eligible account", async () => {
  const originalFindOne = User.findOne;
  const originalIssueAuthToken = tokenService.issueAuthToken;
  const authServicePath = require.resolve("../../services/authService");
  const cachedAuthService = require.cache[authServicePath];
  User.findOne = () => ({
    select: async () => ({
      _id: "user-123",
      email: "durai@example.com",
      tokenVersion: 0,
    }),
  });
  tokenService.issueAuthToken = async () => {
    throw new Error("test token-store failure");
  };
  delete require.cache[authServicePath];

  try {
    const isolatedAuthService = require("../../services/authService");
    const result = await isolatedAuthService.forgotPassword("durai@example.com");

    assert.deepEqual(result, {
      message: "If an eligible account exists, a password reset email has been sent.",
    });
  } finally {
    User.findOne = originalFindOne;
    tokenService.issueAuthToken = originalIssueAuthToken;
    delete require.cache[authServicePath];
    require.cache[authServicePath] = cachedAuthService;
  }
});
