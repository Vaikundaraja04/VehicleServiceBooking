const test = require("node:test");
const assert = require("node:assert/strict");

const User = require("../../models/User");
const emailService = require("../../services/emailService");
const passwordService = require("../../services/passwordService");
const tokenService = require("../../services/tokenService");

async function withIsolatedAuthService(stubs, run) {
  const restorations = [];
  for (const [target, methods] of stubs) {
    for (const [name, replacement] of Object.entries(methods)) {
      restorations.push({
        target,
        name,
        existed: Object.hasOwn(target, name),
        original: target[name],
      });
      target[name] = replacement;
    }
  }

  const authServicePath = require.resolve("../../services/authService");
  const cachedAuthService = require.cache[authServicePath];
  delete require.cache[authServicePath];

  try {
    await run(require("../../services/authService"));
  } finally {
    for (const restoration of restorations.reverse()) {
      if (restoration.existed) {
        restoration.target[restoration.name] = restoration.original;
      } else {
        delete restoration.target[restoration.name];
      }
    }
    delete require.cache[authServicePath];
    if (cachedAuthService) {
      require.cache[authServicePath] = cachedAuthService;
    }
  }
}

function tokenClaim(overrides = {}) {
  return {
    _id: "token-record-1",
    userId: "user-123",
    type: tokenService.TOKEN_TYPES.PASSWORD_RESET,
    tokenHash: tokenService.hashToken("a".repeat(64)),
    claimId: "claim-123",
    tokenVersion: 7,
    ...overrides,
  };
}

test("registration keeps its new account recoverable when verification-token persistence fails", async () => {
  const tokenFailure = new Error("verification token persistence failed");
  const user = {
    _id: "user-123",
    email: "durai@example.com",
    role: "customer",
    isEmailVerified: false,
  };
  let deliveryCalls = 0;

  await withIsolatedAuthService(
    [
      [
        User,
        {
          findOne: () => ({ lean: async () => null }),
          create: async () => user,
        },
      ],
      [passwordService, { hashPassword: async () => "stored-password-hash" }],
      [tokenService, { issueAuthToken: async () => Promise.reject(tokenFailure) }],
      [
        emailService,
        {
          sendVerificationEmail: async () => {
            deliveryCalls += 1;
          },
        },
      ],
    ],
    async (authService) => {
      const result = await authService.registerCustomer({
        username: "durai_01",
        email: "durai@example.com",
        mobile: "9876543210",
        address: "Chennai",
        password: "StrongPass1",
      });

      assert.deepEqual(result, { user, emailSent: false });
      assert.equal(deliveryCalls, 0);
      assert.equal(Object.hasOwn(result, "token"), false);
    },
  );
});

test("verification releases only its exact claim when the user write definitely fails", async () => {
  const claim = tokenClaim({
    type: tokenService.TOKEN_TYPES.EMAIL_VERIFICATION,
    tokenVersion: undefined,
  });
  const updateFailure = new Error("verification user update failed");
  let releasedClaim;
  let completedClaims = 0;

  await withIsolatedAuthService(
    [
      [
        tokenService,
        {
          claimAuthToken: async () => claim,
          releaseAuthToken: async (received) => {
            releasedClaim = received;
          },
          completeAuthToken: async () => {
            completedClaims += 1;
          },
        },
      ],
      [
        User,
        {
          findByIdAndUpdate: async () => Promise.reject(updateFailure),
          findById: async () => ({ isEmailVerified: false }),
        },
      ],
    ],
    async (authService) => {
      await assert.rejects(() => authService.verifyEmail("a".repeat(64)), updateFailure);
      assert.equal(releasedClaim, claim);
      assert.equal(completedClaims, 0);
    },
  );
});

test("verification stays successful when exact-claim completion cleanup fails", async () => {
  const claim = tokenClaim({
    type: tokenService.TOKEN_TYPES.EMAIL_VERIFICATION,
    tokenVersion: undefined,
  });
  const user = { _id: claim.userId, isEmailVerified: true };
  let completionCalls = 0;
  let releaseCalls = 0;
  let updateOptions;

  await withIsolatedAuthService(
    [
      [
        tokenService,
        {
          claimAuthToken: async () => claim,
          completeAuthToken: async () => {
            completionCalls += 1;
            throw new Error("token cleanup failed");
          },
          releaseAuthToken: async () => {
            releaseCalls += 1;
          },
        },
      ],
      [
        User,
        {
          findByIdAndUpdate: async (_id, _update, options) => {
            updateOptions = options;
            return user;
          },
        },
      ],
    ],
    async (authService) => {
      assert.equal(await authService.verifyEmail("a".repeat(64)), user);
      assert.deepEqual(updateOptions, { returnDocument: "after" });
      assert.equal(completionCalls, 1);
      assert.equal(releaseCalls, 0);
    },
  );
});

test("reset releases its exact claim when password hashing fails before the user write", async () => {
  const claim = tokenClaim();
  const hashFailure = new Error("password hashing failed");
  let releasedClaim;
  let userWriteCalls = 0;

  await withIsolatedAuthService(
    [
      [
        tokenService,
        {
          claimAuthToken: async () => claim,
          releaseAuthToken: async (received) => {
            releasedClaim = received;
          },
        },
      ],
      [passwordService, { hashPassword: async () => Promise.reject(hashFailure) }],
      [
        User,
        {
          findByIdAndUpdate: async () => {
            userWriteCalls += 1;
          },
          findOneAndUpdate: async () => {
            userWriteCalls += 1;
          },
        },
      ],
    ],
    async (authService) => {
      await assert.rejects(
        () =>
          authService.resetPassword({
            token: "a".repeat(64),
            newPassword: "NewStrong2",
          }),
        hashFailure,
      );
      assert.equal(releasedClaim, claim);
      assert.equal(userWriteCalls, 0);
    },
  );
});

test("reset binds the atomic password write to the issuing version and ignores cleanup failures", async () => {
  const claim = tokenClaim();
  const updatedUser = { _id: claim.userId, tokenVersion: 8 };
  let updateCall;
  let completionCalls = 0;

  const captureUpdate = async (filter, update, options) => {
    updateCall = { filter, update, options };
    return updatedUser;
  };

  await withIsolatedAuthService(
    [
      [
        tokenService,
        {
          claimAuthToken: async () => claim,
          completeAuthToken: async () => {
            completionCalls += 1;
          },
          removeAuthTokens: async () => Promise.reject(new Error("reset-token cleanup failed")),
        },
      ],
      [passwordService, { hashPassword: async () => "new-password-hash" }],
      [
        User,
        {
          findByIdAndUpdate: captureUpdate,
          findOneAndUpdate: captureUpdate,
        },
      ],
    ],
    async (authService) => {
      const result = await authService.resetPassword({
        token: "a".repeat(64),
        newPassword: "NewStrong2",
      });

      assert.equal(result, updatedUser);
      assert.deepEqual(updateCall, {
        filter: { _id: claim.userId, tokenVersion: 7 },
        update: {
          $set: { passwordHash: "new-password-hash" },
          $inc: { tokenVersion: 1 },
        },
        options: { returnDocument: "after" },
      });
      assert.equal(completionCalls, 1);
    },
  );
});

test("a reset token from an older password version is completed and rejected", async () => {
  const claim = tokenClaim();
  let completedClaim;
  let releasedClaims = 0;

  await withIsolatedAuthService(
    [
      [
        tokenService,
        {
          claimAuthToken: async () => claim,
          completeAuthToken: async (received) => {
            completedClaim = received;
          },
          releaseAuthToken: async () => {
            releasedClaims += 1;
          },
          removeAuthTokens: async () => {},
        },
      ],
      [passwordService, { hashPassword: async () => "new-password-hash" }],
      [
        User,
        {
          findByIdAndUpdate: async () => null,
          findOneAndUpdate: async () => null,
        },
      ],
    ],
    async (authService) => {
      await assert.rejects(
        () =>
          authService.resetPassword({
            token: "a".repeat(64),
            newPassword: "NewStrong2",
          }),
        { statusCode: 400, message: "This link is invalid or expired" },
      );
      assert.equal(completedClaim, claim);
      assert.equal(releasedClaims, 0);
    },
  );
});

test("reset reconciles an ambiguous user-write error before deciding the claim", async () => {
  const claim = tokenClaim();
  const updateFailure = new Error("ambiguous user update");
  const committedUser = {
    _id: claim.userId,
    passwordHash: "new-password-hash",
    tokenVersion: 8,
  };
  let completedClaim;
  let releaseCalls = 0;

  await withIsolatedAuthService(
    [
      [
        tokenService,
        {
          claimAuthToken: async () => claim,
          completeAuthToken: async (received) => {
            completedClaim = received;
          },
          releaseAuthToken: async () => {
            releaseCalls += 1;
          },
          removeAuthTokens: async () => {},
        },
      ],
      [passwordService, { hashPassword: async () => "new-password-hash" }],
      [
        User,
        {
          findByIdAndUpdate: async () => Promise.reject(updateFailure),
          findOneAndUpdate: async () => Promise.reject(updateFailure),
          findOne: async () => committedUser,
        },
      ],
    ],
    async (authService) => {
      const result = await authService.resetPassword({
        token: "a".repeat(64),
        newPassword: "NewStrong2",
      });

      assert.equal(result, committedUser);
      assert.equal(completedClaim, claim);
      assert.equal(releaseCalls, 0);
    },
  );
});

test("forgot-password binds the issued reset token to the current password version", async () => {
  const user = {
    _id: "user-123",
    email: "durai@example.com",
    tokenVersion: 5,
  };
  let selection;
  let issuance;

  await withIsolatedAuthService(
    [
      [
        User,
        {
          findOne: () => ({
            select: async (fields) => {
              selection = fields;
              return user;
            },
          }),
        },
      ],
      [
        tokenService,
        {
          issueAuthToken: async (...args) => {
            issuance = args;
            return "b".repeat(64);
          },
        },
      ],
      [emailService, { sendPasswordResetEmail: async () => {} }],
    ],
    async (authService) => {
      await authService.forgotPassword(user.email);

      assert.equal(selection, "+tokenVersion");
      assert.deepEqual(issuance, [
        user._id,
        tokenService.TOKEN_TYPES.PASSWORD_RESET,
        { tokenVersion: 5 },
      ]);
    },
  );
});
