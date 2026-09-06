const test = require("node:test");
const assert = require("node:assert/strict");

const authController = require("../../controllers/authController");
const authService = require("../../services/authService");

test("register returns a safe user and delivery fallback without a verification token", async () => {
  const originalRegisterCustomer = authService.registerCustomer;
  authService.registerCustomer = async () => ({
    emailSent: false,
    user: {
      id: "user-123",
      username: "durai_01",
      email: "durai@example.com",
      mobile: "9876543210",
      address: "Chennai",
      role: "customer",
      isEmailVerified: false,
      isActive: true,
      passwordHash: "must-not-leak",
      tokenVersion: 1,
    },
  });

  const response = {
    statusCode: null,
    body: null,
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      this.body = body;
    },
  };

  try {
    await authController.register({ validated: validInput() }, response);
  } finally {
    authService.registerCustomer = originalRegisterCustomer;
  }

  assert.equal(response.statusCode, 201);
  assert.equal(response.body.emailSent, false);
  assert.match(response.body.message, /email could not be sent/i);
  assert.equal(Object.hasOwn(response.body, "token"), false);
  assert.equal(Object.hasOwn(response.body.user, "passwordHash"), false);
  assert.equal(response.body.user.role, "customer");
});

function validInput() {
  return {
    username: "durai_01",
    email: "durai@example.com",
    mobile: "9876543210",
    address: "Chennai",
    password: "StrongPass1",
  };
}
