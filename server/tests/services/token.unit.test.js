const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const AuthToken = require("../../models/AuthToken");
const {
  TOKEN_TYPES,
  claimAuthToken,
  completeAuthToken,
  generateRawToken,
  hashToken,
  issueAuthToken,
  releaseAuthToken,
} = require("../../services/tokenService");

test("generateRawToken returns 32 random bytes rendered as lowercase hexadecimal", () => {
  const rawToken = generateRawToken();

  assert.match(rawToken, /^[a-f0-9]{64}$/);
  assert.equal(Buffer.from(rawToken, "hex").length, 32);
});

test("hashToken returns the SHA-256 digest for a valid raw token", () => {
  const rawToken = "a".repeat(64);

  assert.equal(
    hashToken(rawToken),
    crypto.createHash("sha256").update(rawToken).digest("hex"),
  );
});

test("hashToken rejects raw tokens that are not 64 lowercase hexadecimal characters", () => {
  assert.throws(() => hashToken("A".repeat(64)), /64 lowercase hexadecimal/);
  assert.throws(() => hashToken("a".repeat(63)), /64 lowercase hexadecimal/);
  assert.throws(() => hashToken("g".repeat(64)), /64 lowercase hexadecimal/);
});

test("issueAuthToken atomically replaces a user/type token without storing the raw value", async () => {
  const originalFindOneAndUpdate = AuthToken.findOneAndUpdate;
  const originalFindOneAndDelete = AuthToken.findOneAndDelete;
  const originalCreate = AuthToken.create;
  const userId = "user-123";
  const now = 1_700_000_000_000;
  const originalNow = Date.now;
  let received;
  AuthToken.findOneAndUpdate = async (...args) => {
    received = args;
    return { _id: "token-record-1" };
  };
  AuthToken.findOneAndDelete = () => {
    throw new Error("legacy delete-then-create must not be used");
  };
  AuthToken.create = () => {
    throw new Error("legacy create must not be used");
  };
  Date.now = () => now;

  try {
    const rawToken = await issueAuthToken(userId, TOKEN_TYPES.PASSWORD_RESET, {
      tokenVersion: 3,
    });

    assert.match(rawToken, /^[a-f0-9]{64}$/);
    assert.deepEqual(received, [
      { userId, type: TOKEN_TYPES.PASSWORD_RESET },
      {
        $set: {
          tokenHash: hashToken(rawToken),
          expiresAt: new Date(now + 15 * 60 * 1000),
          tokenVersion: 3,
        },
        $unset: { claimId: "", claimedAt: "" },
      },
      { upsert: true, returnDocument: "after" },
    ]);
  } finally {
    AuthToken.findOneAndUpdate = originalFindOneAndUpdate;
    AuthToken.findOneAndDelete = originalFindOneAndDelete;
    AuthToken.create = originalCreate;
    Date.now = originalNow;
  }
});

test("issueAuthToken safely retries a duplicate-key upsert race as an update", async () => {
  const originalFindOneAndUpdate = AuthToken.findOneAndUpdate;
  const originalFindOneAndDelete = AuthToken.findOneAndDelete;
  const originalCreate = AuthToken.create;
  const calls = [];
  AuthToken.findOneAndUpdate = async (...args) => {
    calls.push(args);
    if (calls.length === 1) {
      const error = new Error("duplicate key");
      error.code = 11000;
      throw error;
    }
    return { _id: "token-record-1" };
  };
  AuthToken.findOneAndDelete = () => {
    throw new Error("legacy delete-then-create must not be used");
  };
  AuthToken.create = () => {
    throw new Error("legacy create must not be used");
  };

  try {
    const rawToken = await issueAuthToken(
      "user-123",
      TOKEN_TYPES.PASSWORD_RESET,
      { tokenVersion: 3 },
    );

    assert.match(rawToken, /^[a-f0-9]{64}$/);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0][0], { userId: "user-123", type: TOKEN_TYPES.PASSWORD_RESET });
    assert.equal(calls[0][2].upsert, true);
    assert.deepEqual(calls[1][0], { userId: "user-123", type: TOKEN_TYPES.PASSWORD_RESET });
    assert.deepEqual(calls[1][2], { returnDocument: "after" });
    assert.equal(calls[1][1].$set.tokenHash, hashToken(rawToken));
  } finally {
    AuthToken.findOneAndUpdate = originalFindOneAndUpdate;
    AuthToken.findOneAndDelete = originalFindOneAndDelete;
    AuthToken.create = originalCreate;
  }
});

test("issueAuthToken never returns a raw token after bounded collision retries persist nothing", async () => {
  const originalFindOneAndUpdate = AuthToken.findOneAndUpdate;
  const calls = [];
  AuthToken.findOneAndUpdate = async (...args) => {
    calls.push(args);
    if (args[2].upsert) {
      const error = new Error("duplicate key");
      error.code = 11000;
      throw error;
    }
    return null;
  };

  try {
    await assert.rejects(
      () => issueAuthToken("user-123", TOKEN_TYPES.PASSWORD_RESET, { tokenVersion: 4 }),
      /Authentication token could not be persisted/,
    );
    assert.equal(calls.length, 6);
  } finally {
    AuthToken.findOneAndUpdate = originalFindOneAndUpdate;
  }
});

test("issueAuthToken binds password-reset credentials to a version and clears old claims", async () => {
  const originalFindOneAndUpdate = AuthToken.findOneAndUpdate;
  let received;
  AuthToken.findOneAndUpdate = async (...args) => {
    received = args;
    return { _id: "token-record-1" };
  };

  try {
    await issueAuthToken("user-123", TOKEN_TYPES.PASSWORD_RESET, { tokenVersion: 4 });

    assert.equal(received[1].$set.tokenVersion, 4);
    assert.deepEqual(received[1].$unset, { claimId: "", claimedAt: "" });
  } finally {
    AuthToken.findOneAndUpdate = originalFindOneAndUpdate;
  }
});

test("claimAuthToken atomically blocks concurrent reuse without deleting the record", async () => {
  const originalFindOneAndUpdate = AuthToken.findOneAndUpdate;
  const originalFindOneAndDelete = AuthToken.findOneAndDelete;
  const rawToken = "c".repeat(64);
  const record = { _id: "token-record-1" };
  let received;
  AuthToken.findOneAndUpdate = async (...args) => {
    received = args;
    return record;
  };
  AuthToken.findOneAndDelete = () => {
    throw new Error("claiming must not delete the token record");
  };

  try {
    assert.equal(
      await claimAuthToken(rawToken, TOKEN_TYPES.EMAIL_VERIFICATION),
      record,
    );
    assert.equal(received[0].tokenHash, hashToken(rawToken));
    assert.equal(received[0].type, TOKEN_TYPES.EMAIL_VERIFICATION);
    assert.deepEqual(received[0].claimId, null);
    assert.equal(received[0].expiresAt.$gt instanceof Date, true);
    assert.match(received[1].$set.claimId, /^[a-f0-9]{32}$/);
    assert.equal(received[1].$set.claimedAt instanceof Date, true);
    assert.deepEqual(received[2], { returnDocument: "after" });
  } finally {
    AuthToken.findOneAndUpdate = originalFindOneAndUpdate;
    AuthToken.findOneAndDelete = originalFindOneAndDelete;
  }
});

test("releaseAuthToken releases only the same record hash and claim", async () => {
  const originalUpdateOne = AuthToken.updateOne;
  const claim = {
    _id: "token-record-1",
    tokenHash: hashToken("d".repeat(64)),
    claimId: "claim-123",
  };
  let received;
  AuthToken.updateOne = async (...args) => {
    received = args;
    return { acknowledged: true, matchedCount: 1 };
  };

  try {
    await releaseAuthToken(claim);
    assert.deepEqual(received, [
      {
        _id: claim._id,
        tokenHash: claim.tokenHash,
        claimId: claim.claimId,
      },
      { $unset: { claimId: "", claimedAt: "" } },
    ]);
  } finally {
    AuthToken.updateOne = originalUpdateOne;
  }
});

test("completeAuthToken deletes only the same record hash and claim", async () => {
  const originalDeleteOne = AuthToken.deleteOne;
  const claim = {
    _id: "token-record-1",
    tokenHash: hashToken("e".repeat(64)),
    claimId: "claim-123",
  };
  let received;
  AuthToken.deleteOne = async (...args) => {
    received = args;
    return { acknowledged: true, deletedCount: 1 };
  };

  try {
    await completeAuthToken(claim);
    assert.deepEqual(received, [
      {
        _id: claim._id,
        tokenHash: claim.tokenHash,
        claimId: claim.claimId,
      },
    ]);
  } finally {
    AuthToken.deleteOne = originalDeleteOne;
  }
});

test("AuthToken schema has one user/type record and expiry cleanup indexes", () => {
  const indexes = AuthToken.schema.indexes();

  assert.equal(
    indexes.some(([fields, options]) => fields.userId === 1 && fields.type === 1 && options.unique),
    true,
  );
  assert.equal(
    indexes.some(([fields, options]) => fields.expiresAt === 1 && options.expireAfterSeconds === 0),
    true,
  );
  assert.deepEqual(AuthToken.schema.path("type").enumValues, [
    TOKEN_TYPES.EMAIL_VERIFICATION,
    TOKEN_TYPES.PASSWORD_RESET,
  ]);
});
