const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const { createApp } = require("../../app");
const authService = require("../../services/authService");

const validCustomer = {
  username: "Durai_01",
  email: "DURAI@EXAMPLE.COM ",
  mobile: "9876543210",
  address: " Chennai ",
  password: "StrongPass1",
};

function createTestApp() {
  return createApp({
    rateLimiters: {
      login: [],
      register: [
        (req, res, next) => {
          res.set("X-Register-IP-Limiter", "active");
          next();
        },
        (req, res, next) => {
          res.set("X-Register-Account-Limiter", "active");
          next();
        },
      ],
      resendVerification: [],
      forgotPassword: [],
    },
  });
}

test("register route rejects public role assignment before invoking registration", async () => {
  const response = await request(createTestApp())
    .post("/api/auth/register")
    .send({ ...validCustomer, role: "admin" });

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, {
    message: "Request contains unknown fields",
    errors: [{ field: "role", message: "This field is not allowed" }],
  });
  assert.equal(response.headers["x-register-ip-limiter"], "active");
  assert.equal(response.headers["x-register-account-limiter"], "active");
});

test("register route rejects an unknown field without changing the central error shape", async () => {
  const response = await request(createTestApp())
    .post("/api/auth/register")
    .send({ ...validCustomer, unexpected: true });

  assert.equal(response.status, 400);
  assert.deepEqual(response.body.errors, [
    { field: "unexpected", message: "This field is not allowed" },
  ]);
});

test("register route rejects a password over the bcrypt UTF-8 byte limit before service invocation", async () => {
  const originalRegisterCustomer = authService.registerCustomer;
  let serviceCalls = 0;
  authService.registerCustomer = async () => {
    serviceCalls += 1;
    throw new Error("registration service must not be called");
  };

  let response;
  try {
    response = await request(createTestApp())
      .post("/api/auth/register")
      .send({ ...validCustomer, password: `Aa1${"é".repeat(35)}` });
  } finally {
    authService.registerCustomer = originalRegisterCustomer;
  }

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, {
    message: "Validation failed",
    errors: [{ field: "password", message: "Password must be at most 72 UTF-8 bytes long" }],
  });
  assert.equal(serviceCalls, 0);
});

test("register route counts Unicode code points for the password minimum", async () => {
  const originalRegisterCustomer = authService.registerCustomer;
  let serviceCalls = 0;
  authService.registerCustomer = async () => {
    serviceCalls += 1;
  };

  let response;
  try {
    response = await request(createTestApp())
      .post("/api/auth/register")
      .send({ ...validCustomer, password: "Aa1😀😀😀" });
  } finally {
    authService.registerCustomer = originalRegisterCustomer;
  }

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, {
    message: "Validation failed",
    errors: [
      {
        field: "password",
        message: "Password must contain 8 to 72 characters",
      },
    ],
  });
  assert.equal(serviceCalls, 0);
});

test("register route passes a normalized allowlisted payload to the registration service", async () => {
  const originalRegisterCustomer = authService.registerCustomer;
  let receivedInput;
  authService.registerCustomer = async (input) => {
    receivedInput = input;
    return {
      emailSent: true,
      user: {
        id: "user-123",
        ...input,
        role: "customer",
        isEmailVerified: false,
        isActive: true,
      },
    };
  };

  let response;
  try {
    response = await request(createTestApp()).post("/api/auth/register").send(validCustomer);
  } finally {
    authService.registerCustomer = originalRegisterCustomer;
  }

  assert.equal(response.status, 201);
  assert.deepEqual(receivedInput, {
    username: "durai_01",
    email: "durai@example.com",
    mobile: "9876543210",
    address: "Chennai",
    password: "StrongPass1",
  });
  assert.equal(response.headers["x-register-ip-limiter"], "active");
  assert.equal(response.headers["x-register-account-limiter"], "active");
});
