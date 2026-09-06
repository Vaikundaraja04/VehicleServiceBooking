const crypto = require("node:crypto");

const AuthToken = require("../models/AuthToken");

const TOKEN_TYPES = Object.freeze({
  EMAIL_VERIFICATION: "email_verification",
  PASSWORD_RESET: "password_reset",
});

const TOKEN_LIFETIMES = Object.freeze({
  [TOKEN_TYPES.EMAIL_VERIFICATION]: 60 * 60 * 1000,
  [TOKEN_TYPES.PASSWORD_RESET]: 15 * 60 * 1000,
});

const MAX_PERSIST_ATTEMPTS = 3;

function generateRawToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashToken(rawToken) {
  if (!/^[a-f0-9]{64}$/.test(String(rawToken))) {
    throw new Error("Token must contain 64 lowercase hexadecimal characters");
  }

  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

async function issueAuthToken(userId, type, options = {}) {
  const lifetime = TOKEN_LIFETIMES[type];
  if (!lifetime) {
    throw new Error(`Unsupported authentication token type: ${type}`);
  }

  if (
    type === TOKEN_TYPES.PASSWORD_RESET &&
    (!Number.isInteger(options.tokenVersion) || options.tokenVersion < 0)
  ) {
    throw new Error("Password-reset tokens require a non-negative token version");
  }

  const rawToken = generateRawToken();
  const filter = { userId, type };
  const update = {
    $set: {
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + lifetime),
      ...(type === TOKEN_TYPES.PASSWORD_RESET
        ? { tokenVersion: options.tokenVersion }
        : {}),
    },
    $unset: {
      claimId: "",
      claimedAt: "",
      ...(type === TOKEN_TYPES.EMAIL_VERIFICATION ? { tokenVersion: "" } : {}),
    },
  };

  for (let attempt = 0; attempt < MAX_PERSIST_ATTEMPTS; attempt += 1) {
    let persisted;
    try {
      persisted = await AuthToken.findOneAndUpdate(filter, update, {
        upsert: true,
        returnDocument: "after",
      });
    } catch (error) {
      if (error?.code !== 11000) {
        throw error;
      }
      persisted = await AuthToken.findOneAndUpdate(filter, update, {
        returnDocument: "after",
      });
    }

    if (persisted) {
      return rawToken;
    }
  }

  throw new Error("Authentication token could not be persisted");
}

async function claimAuthToken(rawToken, type) {
  let tokenHash;
  try {
    tokenHash = hashToken(rawToken);
  } catch {
    return null;
  }

  const claimedAt = new Date();
  return AuthToken.findOneAndUpdate(
    {
      tokenHash,
      type,
      expiresAt: { $gt: claimedAt },
      claimId: null,
    },
    {
      $set: {
        claimId: crypto.randomBytes(16).toString("hex"),
        claimedAt,
      },
    },
    { returnDocument: "after" },
  );
}

function exactClaimFilter(claim) {
  if (!claim?._id || !claim.tokenHash || !claim.claimId) {
    throw new Error("A claimed authentication token is required");
  }

  return {
    _id: claim._id,
    tokenHash: claim.tokenHash,
    claimId: claim.claimId,
  };
}

async function releaseAuthToken(claim) {
  return AuthToken.updateOne(exactClaimFilter(claim), {
    $unset: { claimId: "", claimedAt: "" },
  });
}

async function completeAuthToken(claim) {
  return AuthToken.deleteOne(exactClaimFilter(claim));
}

async function consumeAuthToken(rawToken, type) {
  const claim = await claimAuthToken(rawToken, type);
  if (!claim) {
    return null;
  }

  const result = await completeAuthToken(claim);
  return result?.deletedCount === 1 ? claim : null;
}

async function removeAuthTokens(userId, type, additionalFilter = {}) {
  return AuthToken.deleteMany({
    userId,
    ...(type ? { type } : {}),
    ...additionalFilter,
  });
}

module.exports = {
  TOKEN_TYPES,
  generateRawToken,
  hashToken,
  issueAuthToken,
  claimAuthToken,
  completeAuthToken,
  releaseAuthToken,
  consumeAuthToken,
  removeAuthTokens,
};
