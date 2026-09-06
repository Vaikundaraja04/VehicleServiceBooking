const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const { createApp } = require("../../app");
const authService = require("../../services/authService");

function createTestApp() {
  return createApp({
    rateLimiters: {
      login: [],
      register: [],
      resendVerification: [
        (req, res, next) => {
          res.set("X-Resend-IP-Limiter", "active");
          next();
        },
        (req, res, next) => {
          res.set("X-Resend-Account-Limiter", "active");
          next();
        },
      ],
      forgotPassword: [],
    },
  });
}

test("verify email rejects a malformed token before calling the service", async () => {
  const originalVerifyEmail = authService.verifyEmail;
  let serviceCalls = 0;
  authService.verifyEmail = async () => {
    serviceCalls += 1;
  };

  let response;
  try {
    response = await request(createTestApp())
      .post("/api/auth/verify-email")
      .send({ token: "UPPERCASE" });
  } finally {
    authService.verifyEmail = originalVerifyEmail;
  }

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, {
    message: "Validation failed",
    errors: [
      {
        field: "token",
        message: "Token must contain 64 lowercase hexadecimal characters",
      },
    ],
  });
  assert.equal(serviceCalls, 0);
});

test("verify email passes a valid token to the service and returns the success response", async () => {
  const originalVerifyEmail = authService.verifyEmail;
  let receivedToken;
  authService.verifyEmail = async (token) => {
    receivedToken = token;
  };

  const token = "a".repeat(64);
  let response;
  try {
    response = await request(createTestApp()).post("/api/auth/verify-email").send({ token });
  } finally {
    authService.verifyEmail = originalVerifyEmail;
  }

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    message: "Email verified successfully. You can now log in.",
  });
  assert.equal(receivedToken, token);
});

test("resend verification normalizes email and retains both independent limiters", async () => {
  const originalResendVerification = authService.resendVerification;
  let receivedEmail;
  authService.resendVerification = async (email) => {
    receivedEmail = email;
    return {
      message: "If the account can be verified, a new verification email has been sent.",
    };
  };

  let response;
  try {
    response = await request(createTestApp())
      .post("/api/auth/resend-verification")
      .send({ email: " DURAI@EXAMPLE.COM " });
  } finally {
    authService.resendVerification = originalResendVerification;
  }

  assert.equal(response.status, 200);
  assert.equal(
    response.body.message,
    "If the account can be verified, a new verification email has been sent.",
  );
  assert.equal(receivedEmail, "durai@example.com");
  assert.equal(response.headers["x-resend-ip-limiter"], "active");
  assert.equal(response.headers["x-resend-account-limiter"], "active");
});
