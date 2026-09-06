const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const { createApp } = require("../../app");
const authService = require("../../services/authService");
const User = require("../../models/User");
const { signAuthToken } = require("../../services/jwtService");
const { comparePassword, hashPassword } = require("../../services/passwordService");
const tokenService = require("../../services/tokenService");

const authenticatedUser = {
  _id: "507f1f77bcf86cd799439011",
  id: "507f1f77bcf86cd799439011",
  tokenVersion: 0,
  isActive: true,
  isEmailVerified: true,
};

function createTestApp() {
  return createApp({
    rateLimiters: {
      login: [],
      register: [],
      resendVerification: [],
      forgotPassword: [],
    },
  });
}

async function withAuthenticatedUser(run) {
  const originalFindById = User.findById;
  User.findById = () => ({ select: async () => authenticatedUser });
  try {
    await run(`vsb_auth=${signAuthToken(authenticatedUser)}`);
  } finally {
    User.findById = originalFindById;
  }
}

test("change-password requires an authenticated current session", async () => {
  const response = await request(createTestApp())
    .patch("/api/auth/change-password")
    .send({ currentPassword: "StrongPass1", newPassword: "NewStrong2" });

  assert.equal(response.status, 401);
  assert.deepEqual(response.body, { message: "Authentication required" });
});

test("change-password rejects unknown, incomplete, unsafe, and unchanged passwords before the service", async () => {
  const originalChangePassword = authService.changePassword;
  let serviceCalls = 0;
  authService.changePassword = async () => {
    serviceCalls += 1;
  };

  try {
    await withAuthenticatedUser(async (cookie) => {
      const unknown = await request(createTestApp())
        .patch("/api/auth/change-password")
        .set("Cookie", cookie)
        .send({ currentPassword: "StrongPass1", newPassword: "NewStrong2", role: "admin" });
      const missing = await request(createTestApp())
        .patch("/api/auth/change-password")
        .set("Cookie", cookie)
        .send({ newPassword: "NewStrong2" });
      const unsafe = await request(createTestApp())
        .patch("/api/auth/change-password")
        .set("Cookie", cookie)
        .send({ currentPassword: "StrongPass1", newPassword: "A".repeat(68) + "a1😀" });
      const unchanged = await request(createTestApp())
        .patch("/api/auth/change-password")
        .set("Cookie", cookie)
        .send({ currentPassword: "StrongPass1", newPassword: "StrongPass1" });

      assert.equal(unknown.status, 400);
      assert.deepEqual(unknown.body, {
        message: "Request contains unknown fields",
        errors: [{ field: "role", message: "This field is not allowed" }],
      });
      assert.equal(missing.status, 400);
      assert.deepEqual(missing.body, {
        message: "Validation failed",
        errors: [{ field: "currentPassword", message: "Current password must be text" }],
      });
      assert.equal(unsafe.status, 400);
      assert.deepEqual(unsafe.body, {
        message: "Validation failed",
        errors: [
          {
            field: "newPassword",
            message: "Password must be at most 72 UTF-8 bytes long",
          },
        ],
      });
      assert.equal(unchanged.status, 400);
      assert.deepEqual(unchanged.body, {
        message: "Validation failed",
        errors: [
          {
            field: "newPassword",
            message: "New password must be different from the current password",
          },
        ],
      });
    });
    assert.equal(serviceCalls, 0);
  } finally {
    authService.changePassword = originalChangePassword;
  }
});

test("change-password forwards validated credentials, clears the scoped cookie, and returns no secrets", async () => {
  const originalChangePassword = authService.changePassword;
  let receivedInput;
  authService.changePassword = async (input) => {
    receivedInput = input;
  };

  try {
    await withAuthenticatedUser(async (cookie) => {
      const response = await request(createTestApp())
        .patch("/api/auth/change-password")
        .set("Cookie", cookie)
        .send({ currentPassword: "StrongPass1", newPassword: "NewStrong2" });

      assert.equal(response.status, 200);
      assert.deepEqual(response.body, {
        message: "Password changed successfully. Log in again.",
      });
      assert.deepEqual(receivedInput, {
        userId: authenticatedUser._id,
        currentPassword: "StrongPass1",
        newPassword: "NewStrong2",
      });
      assert.match(response.headers["set-cookie"][0], /^vsb_auth=;/);
      assert.match(response.headers["set-cookie"][0], /HttpOnly/i);
      assert.match(response.headers["set-cookie"][0], /SameSite=Lax/i);
      assert.match(response.headers["set-cookie"][0], /Path=\//i);
      assert.equal(JSON.stringify(response.body).includes("StrongPass1"), false);
      assert.equal(JSON.stringify(response.body).includes("NewStrong2"), false);
    });
  } finally {
    authService.changePassword = originalChangePassword;
  }
});

test("change-password service atomically replaces the hash, increments version, and removes recovery tokens", async () => {
  const originalFindById = User.findById;
  const originalFindByIdAndUpdate = User.findByIdAndUpdate;
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const originalRemoveAuthTokens = tokenService.removeAuthTokens;
  const authServicePath = require.resolve("../../services/authService");
  const cachedAuthService = require.cache[authServicePath];
  const user = {
    _id: authenticatedUser._id,
    passwordHash: await hashPassword("StrongPass1"),
    tokenVersion: 3,
  };
  let updateCall;
  let removedTokens;
  User.findById = () => ({ select: async () => user });
  const captureUpdate = async (filter, update, options) => {
    updateCall = { filter, update, options };
    return { _id: user._id, tokenVersion: 4 };
  };
  User.findByIdAndUpdate = captureUpdate;
  User.findOneAndUpdate = captureUpdate;
  tokenService.removeAuthTokens = async (userId, type, additionalFilter) => {
    removedTokens = { userId, type, additionalFilter };
  };
  delete require.cache[authServicePath];

  try {
    const isolatedAuthService = require("../../services/authService");
    await isolatedAuthService.changePassword({
      userId: user._id,
      currentPassword: "StrongPass1",
      newPassword: "NewStrong2",
    });

    assert.deepEqual(updateCall.filter, {
      _id: user._id,
      passwordHash: user.passwordHash,
      tokenVersion: 3,
    });
    assert.equal(await comparePassword("NewStrong2", updateCall.update.$set.passwordHash), true);
    assert.deepEqual(updateCall.update.$inc, { tokenVersion: 1 });
    assert.deepEqual(updateCall.options, { returnDocument: "after" });
    assert.deepEqual(removedTokens, {
      userId: user._id,
      type: tokenService.TOKEN_TYPES.PASSWORD_RESET,
      additionalFilter: { tokenVersion: { $lt: 4 } },
    });
  } finally {
    User.findById = originalFindById;
    User.findByIdAndUpdate = originalFindByIdAndUpdate;
    User.findOneAndUpdate = originalFindOneAndUpdate;
    tokenService.removeAuthTokens = originalRemoveAuthTokens;
    delete require.cache[authServicePath];
    require.cache[authServicePath] = cachedAuthService;
  }
});

test("change-password returns its committed update when reset-token cleanup fails", async () => {
  const originalFindById = User.findById;
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const originalRemoveAuthTokens = tokenService.removeAuthTokens;
  const authServicePath = require.resolve("../../services/authService");
  const cachedAuthService = require.cache[authServicePath];
  const user = {
    _id: authenticatedUser._id,
    passwordHash: await hashPassword("StrongPass1"),
    tokenVersion: 3,
  };
  const updatedUser = { _id: user._id, tokenVersion: 4 };
  User.findById = () => ({ select: async () => user });
  User.findOneAndUpdate = async () => updatedUser;
  tokenService.removeAuthTokens = async () => {
    throw new Error("reset-token cleanup failed");
  };
  delete require.cache[authServicePath];

  try {
    const isolatedAuthService = require("../../services/authService");
    const result = await isolatedAuthService.changePassword({
      userId: user._id,
      currentPassword: "StrongPass1",
      newPassword: "NewStrong2",
    });

    assert.equal(result, updatedUser);
  } finally {
    User.findById = originalFindById;
    User.findOneAndUpdate = originalFindOneAndUpdate;
    tokenService.removeAuthTokens = originalRemoveAuthTokens;
    delete require.cache[authServicePath];
    require.cache[authServicePath] = cachedAuthService;
  }
});

test("change-password service rejects an incorrect current password without changing data", async () => {
  const originalFindById = User.findById;
  const authServicePath = require.resolve("../../services/authService");
  const cachedAuthService = require.cache[authServicePath];
  const user = {
    _id: authenticatedUser._id,
    passwordHash: await hashPassword("StrongPass1"),
    tokenVersion: 3,
    saveCalls: 0,
    async save() {
      this.saveCalls += 1;
    },
  };
  User.findById = () => ({ select: async () => user });
  delete require.cache[authServicePath];

  try {
    const isolatedAuthService = require("../../services/authService");
    await assert.rejects(
      () =>
        isolatedAuthService.changePassword({
          userId: user._id,
          currentPassword: "WrongPass1",
          newPassword: "NewStrong2",
        }),
      { statusCode: 401, message: "Current password is incorrect" },
    );

    assert.equal(user.saveCalls, 0);
    assert.equal(user.tokenVersion, 3);
    assert.equal(await comparePassword("StrongPass1", user.passwordHash), true);
  } finally {
    User.findById = originalFindById;
    delete require.cache[authServicePath];
    require.cache[authServicePath] = cachedAuthService;
  }
});

test("change-password service does not remove recovery tokens when the atomic update fails", async () => {
  const originalFindById = User.findById;
  const originalFindByIdAndUpdate = User.findByIdAndUpdate;
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const originalRemoveAuthTokens = tokenService.removeAuthTokens;
  const authServicePath = require.resolve("../../services/authService");
  const cachedAuthService = require.cache[authServicePath];
  const user = {
    _id: authenticatedUser._id,
    passwordHash: await hashPassword("StrongPass1"),
    tokenVersion: 3,
  };
  let removeCalls = 0;
  User.findById = () => ({ select: async () => user });
  User.findByIdAndUpdate = async () => null;
  User.findOneAndUpdate = async () => null;
  tokenService.removeAuthTokens = async () => {
    removeCalls += 1;
  };
  delete require.cache[authServicePath];

  try {
    const isolatedAuthService = require("../../services/authService");
    await assert.rejects(
      () =>
        isolatedAuthService.changePassword({
          userId: user._id,
          currentPassword: "StrongPass1",
          newPassword: "NewStrong2",
        }),
      {
        statusCode: 409,
        message: "Password changed in another request. Log in again.",
      },
    );
    assert.equal(removeCalls, 0);
  } finally {
    User.findById = originalFindById;
    User.findByIdAndUpdate = originalFindByIdAndUpdate;
    User.findOneAndUpdate = originalFindOneAndUpdate;
    tokenService.removeAuthTokens = originalRemoveAuthTokens;
    delete require.cache[authServicePath];
    require.cache[authServicePath] = cachedAuthService;
  }
});

test("concurrent password changes from the same loaded credentials allow only one write", async () => {
  const originalFindById = User.findById;
  const originalFindByIdAndUpdate = User.findByIdAndUpdate;
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const originalRemoveAuthTokens = tokenService.removeAuthTokens;
  const authServicePath = require.resolve("../../services/authService");
  const cachedAuthService = require.cache[authServicePath];
  const originalHash = await hashPassword("StrongPass1");
  const persisted = { passwordHash: originalHash, tokenVersion: 7 };

  User.findById = () => ({
    select: async () => ({
      _id: authenticatedUser._id,
      passwordHash: originalHash,
      tokenVersion: 7,
    }),
  });
  User.findByIdAndUpdate = async (_id, update) => {
    persisted.passwordHash = update.$set.passwordHash;
    persisted.tokenVersion += update.$inc.tokenVersion;
    return { _id: authenticatedUser._id, tokenVersion: persisted.tokenVersion };
  };
  User.findOneAndUpdate = async (filter, update) => {
    if (
      filter.passwordHash !== persisted.passwordHash ||
      filter.tokenVersion !== persisted.tokenVersion
    ) {
      return null;
    }
    persisted.passwordHash = update.$set.passwordHash;
    persisted.tokenVersion += update.$inc.tokenVersion;
    return { _id: authenticatedUser._id, tokenVersion: persisted.tokenVersion };
  };
  tokenService.removeAuthTokens = async () => {};
  delete require.cache[authServicePath];

  try {
    const isolatedAuthService = require("../../services/authService");
    const results = await Promise.allSettled([
      isolatedAuthService.changePassword({
        userId: authenticatedUser._id,
        currentPassword: "StrongPass1",
        newPassword: "NewStrong2",
      }),
      isolatedAuthService.changePassword({
        userId: authenticatedUser._id,
        currentPassword: "StrongPass1",
        newPassword: "AnotherStrong3",
      }),
    ]);

    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = results.find((result) => result.status === "rejected");
    assert.equal(rejected.reason.statusCode, 409);
    assert.equal(
      rejected.reason.message,
      "Password changed in another request. Log in again.",
    );
    assert.equal(persisted.tokenVersion, 8);
  } finally {
    User.findById = originalFindById;
    User.findByIdAndUpdate = originalFindByIdAndUpdate;
    User.findOneAndUpdate = originalFindOneAndUpdate;
    tokenService.removeAuthTokens = originalRemoveAuthTokens;
    delete require.cache[authServicePath];
    require.cache[authServicePath] = cachedAuthService;
  }
});
