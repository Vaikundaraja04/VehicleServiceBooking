const test = require("node:test");
const assert = require("node:assert/strict");

const AdminInvitation = require("../../models/AdminInvitation");
const User = require("../../models/User");
const emailService = require("../../services/emailService");
const passwordService = require("../../services/passwordService");
const tokenService = require("../../services/tokenService");

async function withIsolatedAuthService(stubs, run) {
  const restorations = [];
  for (const [target, methods] of stubs) {
    for (const [name, replacement] of Object.entries(methods)) {
      restorations.push([target, name, target[name]]);
      target[name] = replacement;
    }
  }

  const authServicePath = require.resolve("../../services/authService");
  const cachedAuthService = require.cache[authServicePath];
  delete require.cache[authServicePath];

  try {
    await run(require("../../services/authService"));
  } finally {
    for (const [target, name, original] of restorations.reverse()) {
      target[name] = original;
    }
    delete require.cache[authServicePath];
    if (cachedAuthService) {
      require.cache[authServicePath] = cachedAuthService;
    }
  }
}

test("invitation creation atomically stores a 24-hour hash and returns the manual-copy link without email", async () => {
  let persistence;
  let invitationEmailCalls = 0;
  const order = [];
  const storedInvitation = {
    _id: "invitation-1",
    invitedEmail: "invited@example.com",
    expiresAt: null,
  };
  emailService.setTransporterForTests({
    async sendMail() {
      order.push("deliver");
      invitationEmailCalls += 1;
    },
  });

  try {
    await withIsolatedAuthService(
      [
        [User, { exists: async () => false }],
        [
          AdminInvitation,
          {
            findOneAndUpdate: async (filter, update, options) => {
              order.push("persist");
              persistence = { filter, update, options };
              storedInvitation.expiresAt = update.$set.expiresAt;
              return storedInvitation;
            },
          },
        ],
      ],
      async (authService) => {
        const before = Date.now();
        const result = await authService.createAdminInvitation({
          email: "invited@example.com",
          invitedBy: "507f1f77bcf86cd799439011",
        });
        const after = Date.now();

        assert.equal(invitationEmailCalls, 0);
        assert.deepEqual(order, ["persist"]);
        assert.deepEqual(persistence.filter, {
          invitedEmail: "invited@example.com",
          usedAt: null,
        });
        assert.equal(persistence.update.$set.invitedBy, "507f1f77bcf86cd799439011");
        assert.match(persistence.update.$set.tokenHash, /^[a-f0-9]{64}$/);
        assert.equal(
          persistence.update.$set.tokenHash,
          tokenService.hashToken(
            new URL(result.invitationLink).searchParams.get("token"),
          ),
        );
        assert.ok(persistence.update.$set.expiresAt.getTime() >= before + 24 * 60 * 60 * 1000);
        assert.ok(persistence.update.$set.expiresAt.getTime() <= after + 24 * 60 * 60 * 1000);
        assert.deepEqual(persistence.options, {
          returnDocument: "after",
          upsert: true,
          setDefaultsOnInsert: true,
        });
        assert.match(
          result.invitationLink,
          /^http:\/\/localhost:5173\/admin\/accept-invitation\?token=[a-f0-9]{64}&email=invited%40example\.com$/,
        );
        assert.equal(Object.hasOwn(result, "token"), false);
      },
    );
  } finally {
    emailService.resetTransporterForTests();
  }
});

test("invitation replacement retries an upsert collision without creating another unused record", async () => {
  const calls = [];
  const invitation = {
    _id: "invitation-1",
    invitedEmail: "invited@example.com",
    expiresAt: new Date(),
  };

  await withIsolatedAuthService(
    [
      [User, { exists: async () => false }],
      [
        AdminInvitation,
        {
          findOneAndUpdate: async (filter, update, options) => {
            calls.push({ filter, update, options });
            if (calls.length === 1) {
              const error = new Error("duplicate partial index");
              error.code = 11000;
              throw error;
            }
            return invitation;
          },
        },
      ],
    ],
    async (authService) => {
      await authService.createAdminInvitation({
        email: "invited@example.com",
        invitedBy: "507f1f77bcf86cd799439011",
      });

      assert.equal(calls.length, 2);
      assert.equal(calls[0].options.upsert, true);
      assert.deepEqual(calls[1].options, { returnDocument: "after" });
      assert.deepEqual(calls[1].filter, {
        invitedEmail: "invited@example.com",
        usedAt: null,
      });
      assert.equal(calls[1].update.$set.tokenHash, calls[0].update.$set.tokenHash);
    },
  );
});

test("invitation creation never returns a link after bounded collision retries persist nothing", async () => {
  const calls = [];

  await withIsolatedAuthService(
    [
      [User, { exists: async () => false }],
      [
        AdminInvitation,
        {
          findOneAndUpdate: async (filter, update, options) => {
            calls.push({ filter, update, options });
            if (options.upsert) {
              const error = new Error("duplicate partial index");
              error.code = 11000;
              throw error;
            }
            return null;
          },
        },
      ],
    ],
    async (authService) => {
      await assert.rejects(
        () =>
          authService.createAdminInvitation({
            email: "invited@example.com",
            invitedBy: "507f1f77bcf86cd799439011",
          }),
        /Administrator invitation could not be persisted/,
      );
      assert.equal(calls.length, 6);
    },
  );
});

test("invitation creation rejects an existing account before storing a link", async () => {
  let persistenceCalls = 0;

  await withIsolatedAuthService(
    [
      [User, { exists: async () => true }],
      [AdminInvitation, { findOneAndUpdate: async () => (persistenceCalls += 1) }],
    ],
    async (authService) => {
      await assert.rejects(
        () =>
          authService.createAdminInvitation({
            email: "existing@example.com",
            invitedBy: "507f1f77bcf86cd799439011",
          }),
        { statusCode: 409, message: "An account already uses this email" },
      );
      assert.equal(persistenceCalls, 0);
    },
  );
});

test("invitation acceptance atomically binds token and email, creates only an admin, and verifies by email", async () => {
  let consumption;
  let createdUserInput;
  let issuedToken;
  let verificationDelivery;
  const invitation = { _id: "invitation-1" };
  const user = {
    _id: "507f1f77bcf86cd799439012",
    id: "507f1f77bcf86cd799439012",
    username: "new_admin",
    email: "invited@example.com",
    role: "admin",
    isEmailVerified: false,
    isActive: true,
  };

  await withIsolatedAuthService(
    [
      [
        User,
        {
          exists: async () => false,
          create: async (input) => {
            createdUserInput = input;
            return user;
          },
        },
      ],
      [
        AdminInvitation,
        {
          findOneAndUpdate: async (filter, update, options) => {
            consumption = { filter, update, options };
            return invitation;
          },
        },
      ],
      [
        tokenService,
        {
          issueAuthToken: async (userId, type) => {
            issuedToken = { userId, type };
            return "d".repeat(64);
          },
        },
      ],
      [
        emailService,
        {
          sendVerificationEmail: async (message) => {
            verificationDelivery = message;
          },
        },
      ],
    ],
    async (authService) => {
      const result = await authService.acceptAdminInvitation({
        token: "c".repeat(64),
        email: "invited@example.com",
        username: "new_admin",
        password: "AdminStrong2",
        role: "customer",
      });

      assert.equal(consumption.filter.tokenHash, tokenService.hashToken("c".repeat(64)));
      assert.equal(consumption.filter.invitedEmail, "invited@example.com");
      assert.equal(consumption.filter.usedAt, null);
      assert.equal(consumption.filter.expiresAt.$gt, consumption.update.$set.usedAt);
      assert.deepEqual(consumption.options, { returnDocument: "after" });
      assert.equal(createdUserInput.username, "new_admin");
      assert.equal(createdUserInput.email, "invited@example.com");
      assert.equal(createdUserInput.role, "admin");
      assert.equal(createdUserInput.isEmailVerified, false);
      assert.equal(createdUserInput.isActive, true);
      assert.equal(await passwordService.comparePassword("AdminStrong2", createdUserInput.passwordHash), true);
      assert.equal(createdUserInput.passwordHash.startsWith("$2b$12$"), true);
      assert.deepEqual(issuedToken, {
        userId: user._id,
        type: tokenService.TOKEN_TYPES.EMAIL_VERIFICATION,
      });
      assert.deepEqual(verificationDelivery, {
        to: "invited@example.com",
        token: "d".repeat(64),
      });
      assert.deepEqual(result, { user, emailSent: true });
    },
  );
});

test("invalid, expired, mismatched, and replayed invitations share one safe error", async () => {
  let userCreateCalls = 0;

  await withIsolatedAuthService(
    [
      [
        User,
        {
          exists: async () => false,
          create: async () => (userCreateCalls += 1),
        },
      ],
      [AdminInvitation, { findOneAndUpdate: async () => null }],
    ],
    async (authService) => {
      await assert.rejects(
        () =>
          authService.acceptAdminInvitation({
            token: "e".repeat(64),
            email: "wrong@example.com",
            username: "new_admin",
            password: "AdminStrong2",
          }),
        { statusCode: 400, message: "This link is invalid or expired" },
      );
      assert.equal(userCreateCalls, 0);
    },
  );
});

test("a bogus invitation cannot enumerate an existing account email", async () => {
  let userLookupCalls = 0;

  await withIsolatedAuthService(
    [
      [
        User,
        {
          exists: async () => {
            userLookupCalls += 1;
            return true;
          },
        },
      ],
      [AdminInvitation, { findOneAndUpdate: async () => null }],
    ],
    async (authService) => {
      await assert.rejects(
        () =>
          authService.acceptAdminInvitation({
            token: "a".repeat(64),
            email: "existing@example.com",
            username: "new_admin",
            password: "AdminStrong2",
          }),
        { statusCode: 400, message: "This link is invalid or expired" },
      );
      assert.equal(userLookupCalls, 0);
    },
  );
});

test("a duplicate-user race releases the claimed invitation for a safe retry", async () => {
  let rollback;
  const duplicateError = new Error("duplicate user");
  duplicateError.code = 11000;
  duplicateError.keyPattern = { email: 1 };

  await withIsolatedAuthService(
    [
      [User, { exists: async () => false, create: async () => Promise.reject(duplicateError) }],
      [
        AdminInvitation,
        {
          findOneAndUpdate: async (_filter, update) => ({
            _id: "invitation-1",
            usedAt: update.$set.usedAt,
          }),
          updateOne: async (filter, update) => {
            rollback = { filter, update };
          },
        },
      ],
    ],
    async (authService) => {
      await assert.rejects(
        () =>
          authService.acceptAdminInvitation({
            token: "f".repeat(64),
            email: "invited@example.com",
            username: "new_admin",
            password: "AdminStrong2",
          }),
        duplicateError,
      );
      assert.equal(rollback.filter._id, "invitation-1");
      assert.equal(rollback.filter.usedAt instanceof Date, true);
      assert.deepEqual(rollback.update, { $set: { usedAt: null } });
    },
  );
});

test("verification-token persistence failure removes the new admin and releases only its exact claim", async () => {
  let deletedUserFilter;
  let removedTokens;
  let rollback;
  const cleanupOrder = [];
  const tokenFailure = new Error("verification token persistence failed");
  const user = {
    _id: "507f1f77bcf86cd799439012",
    email: "invited@example.com",
  };

  await withIsolatedAuthService(
    [
      [
        User,
        {
          exists: async () => false,
          create: async () => user,
          deleteOne: async (filter) => {
            cleanupOrder.push("delete-user");
            deletedUserFilter = filter;
            return { acknowledged: true, deletedCount: 1 };
          },
        },
      ],
      [
        AdminInvitation,
        {
          findOneAndUpdate: async (_filter, update) => ({
            _id: "invitation-1",
            usedAt: update.$set.usedAt,
          }),
          updateOne: async (filter, update) => {
            cleanupOrder.push("release-claim");
            rollback = { filter, update };
          },
        },
      ],
      [
        tokenService,
        {
          issueAuthToken: async () => Promise.reject(tokenFailure),
          removeAuthTokens: async (userId, type) => {
            cleanupOrder.push("remove-token");
            removedTokens = { userId, type };
          },
        },
      ],
    ],
    async (authService) => {
      await assert.rejects(
        () =>
          authService.acceptAdminInvitation({
            token: "a".repeat(64),
            email: "invited@example.com",
            username: "new_admin",
            password: "AdminStrong2",
          }),
        tokenFailure,
      );

      assert.deepEqual(deletedUserFilter, { _id: user._id });
      assert.deepEqual(removedTokens, {
        userId: user._id,
        type: tokenService.TOKEN_TYPES.EMAIL_VERIFICATION,
      });
      assert.equal(rollback.filter._id, "invitation-1");
      assert.equal(rollback.filter.usedAt instanceof Date, true);
      assert.deepEqual(rollback.update, { $set: { usedAt: null } });
      assert.deepEqual(cleanupOrder, ["remove-token", "delete-user", "release-claim"]);
    },
  );
});

test("failed new-admin deletion keeps the invitation claim consumed", async () => {
  let releaseCalls = 0;
  const cleanupOrder = [];
  const tokenFailure = new Error("verification token persistence failed");
  const deleteFailure = new Error("new admin deletion failed");

  await withIsolatedAuthService(
    [
      [
        User,
        {
          exists: async () => false,
          create: async () => ({ _id: "507f1f77bcf86cd799439012" }),
          deleteOne: async () => {
            cleanupOrder.push("delete-user");
            throw deleteFailure;
          },
        },
      ],
      [
        AdminInvitation,
        {
          findOneAndUpdate: async () => ({ _id: "invitation-1" }),
          updateOne: async () => {
            releaseCalls += 1;
            cleanupOrder.push("release-claim");
          },
        },
      ],
      [
        tokenService,
        {
          issueAuthToken: async () => Promise.reject(tokenFailure),
          removeAuthTokens: async () => {
            cleanupOrder.push("remove-token");
          },
        },
      ],
    ],
    async (authService) => {
      await assert.rejects(
        () =>
          authService.acceptAdminInvitation({
            token: "b".repeat(64),
            email: "invited@example.com",
            username: "new_admin",
            password: "AdminStrong2",
          }),
        tokenFailure,
      );

      assert.deepEqual(cleanupOrder, ["remove-token", "delete-user"]);
      assert.equal(releaseCalls, 0);
    },
  );
});
