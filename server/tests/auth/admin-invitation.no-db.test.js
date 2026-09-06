const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const { createApp } = require("../../app");
const authService = require("../../services/authService");
const User = require("../../models/User");
const { signAuthToken } = require("../../services/jwtService");

function createTestApp() {
  return createApp({
    rateLimiters: {
      login: [],
      register: [],
      resendVerification: [],
      forgotPassword: [],
      adminInvitation: [],
    },
  });
}

function createLimitedTestApp() {
  return createApp({
    rateLimiters: {
      login: [],
      register: [],
      resendVerification: [],
      forgotPassword: [],
      adminInvitation: [
        (req, res, next) => {
          res.set("X-Invitation-IP-Limiter", "active");
          next();
        },
        (req, res, next) => {
          res.set("X-Invitation-Account-Limiter", "active");
          next();
        },
      ],
    },
  });
}

const sessionUser = {
  _id: "507f1f77bcf86cd799439011",
  id: "507f1f77bcf86cd799439011",
  role: "admin",
  tokenVersion: 0,
  isActive: true,
  isEmailVerified: true,
};

async function withCurrentUser(user, run) {
  const originalFindById = User.findById;
  User.findById = () => ({ select: async () => user });
  try {
    await run(`vsb_auth=${signAuthToken(sessionUser)}`);
  } finally {
    User.findById = originalFindById;
  }
}

test("administrator invitation creation requires authentication before processing input", async () => {
  const response = await request(createTestApp())
    .post("/api/admin/invitations")
    .send({ email: "invited@example.com" });

  assert.equal(response.status, 401);
  assert.deepEqual(response.body, { message: "Authentication required" });
});

test("administrator invitation creation uses the current database role", async () => {
  const demotedUser = { ...sessionUser, role: "customer" };

  await withCurrentUser(demotedUser, async (cookie) => {
    const response = await request(createLimitedTestApp())
      .post("/api/admin/invitations")
      .set("Cookie", cookie)
      .send({ email: "invited@example.com" });

    assert.equal(response.status, 403);
    assert.deepEqual(response.body, {
      message: "You do not have permission for this action",
    });
    assert.equal(response.headers["x-invitation-ip-limiter"], undefined);
    assert.equal(response.headers["x-invitation-account-limiter"], undefined);
  });
});

test("administrator invitation creation normalizes input and returns the copyable link", async () => {
  const originalCreateAdminInvitation = authService.createAdminInvitation;
  let receivedInput;
  authService.createAdminInvitation = async (input) => {
    receivedInput = input;
    return {
      invitation: {
        invitedEmail: input.email,
        expiresAt: new Date("2026-08-27T12:00:00.000Z"),
      },
      invitationLink:
        "http://localhost:5173/admin/accept-invitation?token=" +
        "a".repeat(64) +
        "&email=invited%40example.com",
    };
  };

  try {
    await withCurrentUser(sessionUser, async (cookie) => {
      const response = await request(createLimitedTestApp())
        .post("/api/admin/invitations")
        .set("Cookie", cookie)
        .send({ email: " INVITED@EXAMPLE.COM " });

      assert.equal(response.status, 201);
      assert.deepEqual(receivedInput, {
        email: "invited@example.com",
        invitedBy: sessionUser._id,
      });
      assert.deepEqual(Object.keys(response.body).sort(), [
        "expiresAt",
        "invitationLink",
        "invitedEmail",
        "message",
      ]);
      assert.deepEqual(response.body, {
        message: "Administrator invitation created",
        invitedEmail: "invited@example.com",
        expiresAt: "2026-08-27T12:00:00.000Z",
        invitationLink:
          "http://localhost:5173/admin/accept-invitation?token=" +
          "a".repeat(64) +
          "&email=invited%40example.com",
      });
      assert.equal(response.headers["x-invitation-ip-limiter"], "active");
      assert.equal(response.headers["x-invitation-account-limiter"], "active");
      assert.equal(Object.hasOwn(response.body, "token"), false);
      assert.equal(Object.hasOwn(response.body, "tokenHash"), false);
    });
  } finally {
    authService.createAdminInvitation = originalCreateAdminInvitation;
  }
});

test("administrator invitation creation rejects unknown fields before the service", async () => {
  const originalCreateAdminInvitation = authService.createAdminInvitation;
  let serviceCalls = 0;
  authService.createAdminInvitation = async () => {
    serviceCalls += 1;
  };

  try {
    await withCurrentUser(sessionUser, async (cookie) => {
      const response = await request(createLimitedTestApp())
        .post("/api/admin/invitations")
        .set("Cookie", cookie)
        .send({ email: "invited@example.com", role: "admin" });

      assert.equal(response.status, 400);
      assert.deepEqual(response.body, {
        message: "Request contains unknown fields",
        errors: [{ field: "role", message: "This field is not allowed" }],
      });
    });
    assert.equal(serviceCalls, 0);
  } finally {
    authService.createAdminInvitation = originalCreateAdminInvitation;
  }
});

test("administrator invitation acceptance validates the bound profile before the service", async () => {
  const originalAcceptAdminInvitation = authService.acceptAdminInvitation;
  let serviceCalls = 0;
  authService.acceptAdminInvitation = async () => {
    serviceCalls += 1;
  };

  try {
    const roleInjection = await request(createTestApp())
      .post("/api/auth/admin-invitations/accept")
      .send({
        token: "a".repeat(64),
        email: "invited@example.com",
        username: "new_admin",
        password: "AdminStrong2",
        role: "customer",
      });
    const unsafePassword = await request(createTestApp())
      .post("/api/auth/admin-invitations/accept")
      .send({
        token: "b".repeat(64),
        email: "invited@example.com",
        username: "new_admin",
        password: "A".repeat(68) + "a1😀",
      });
    const malformedToken = await request(createTestApp())
      .post("/api/auth/admin-invitations/accept")
      .send({
        token: "not-a-token",
        email: "invited@example.com",
        username: "new_admin",
        password: "AdminStrong2",
      });

    assert.equal(roleInjection.status, 400);
    assert.deepEqual(roleInjection.body, {
      message: "Request contains unknown fields",
      errors: [{ field: "role", message: "This field is not allowed" }],
    });
    assert.equal(unsafePassword.status, 400);
    assert.deepEqual(unsafePassword.body, {
      message: "Validation failed",
      errors: [
        {
          field: "password",
          message: "Password must be at most 72 UTF-8 bytes long",
        },
      ],
    });
    assert.equal(malformedToken.status, 400);
    assert.deepEqual(malformedToken.body, {
      message: "Validation failed",
      errors: [
        {
          field: "token",
          message: "Token must contain 64 lowercase hexadecimal characters",
        },
      ],
    });
    assert.equal(serviceCalls, 0);
  } finally {
    authService.acceptAdminInvitation = originalAcceptAdminInvitation;
  }
});

test("administrator invitation acceptance forwards normalized input and returns a safe admin", async () => {
  const originalAcceptAdminInvitation = authService.acceptAdminInvitation;
  let receivedInput;
  authService.acceptAdminInvitation = async (input) => {
    receivedInput = input;
    return {
      emailSent: true,
      user: {
        id: "507f1f77bcf86cd799439012",
        username: input.username,
        email: input.email,
        role: "admin",
        isEmailVerified: false,
        isActive: true,
        passwordHash: "must-not-leak",
        tokenVersion: 0,
      },
    };
  };

  try {
    const response = await request(createTestApp())
      .post("/api/auth/admin-invitations/accept")
      .send({
        token: "c".repeat(64),
        email: " INVITED@EXAMPLE.COM ",
        username: " New_Admin ",
        password: "AdminStrong2",
      });

    assert.equal(response.status, 201);
    assert.deepEqual(receivedInput, {
      token: "c".repeat(64),
      email: "invited@example.com",
      username: "new_admin",
      password: "AdminStrong2",
    });
    assert.equal(
      response.body.message,
      "Administrator account created. Check the invited email to verify it.",
    );
    assert.equal(response.body.emailSent, true);
    assert.equal(response.body.user.role, "admin");
    assert.equal(response.body.user.isEmailVerified, false);
    assert.equal(Object.hasOwn(response.body.user, "passwordHash"), false);
    assert.equal(Object.hasOwn(response.body.user, "tokenVersion"), false);
    assert.equal(Object.hasOwn(response.body, "token"), false);
    assert.doesNotMatch(JSON.stringify(response.body), /AdminStrong2|c{64}/);
  } finally {
    authService.acceptAdminInvitation = originalAcceptAdminInvitation;
  }
});
