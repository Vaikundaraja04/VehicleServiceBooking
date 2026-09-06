const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const AuthToken = require("../../models/AuthToken");
const {
  TOKEN_TYPES,
  claimAuthToken,
  completeAuthToken,
  hashToken,
  issueAuthToken,
  releaseAuthToken,
  consumeAuthToken,
} = require("../../services/tokenService");
const {
  connectTestDb,
  clearTestDb,
  disconnectTestDb,
} = require("../helpers/testDb");

test.before(connectTestDb);
test.beforeEach(clearTestDb);
test.after(disconnectTestDb);

test("issuing a token stores only its SHA-256 hash and replaces the old token", async () => {
  const userId = new mongoose.Types.ObjectId();
  const firstRaw = await issueAuthToken(userId, TOKEN_TYPES.EMAIL_VERIFICATION);
  const secondRaw = await issueAuthToken(userId, TOKEN_TYPES.EMAIL_VERIFICATION);
  const records = await AuthToken.find({ userId });

  assert.match(firstRaw, /^[a-f0-9]{64}$/);
  assert.match(secondRaw, /^[a-f0-9]{64}$/);
  assert.notEqual(firstRaw, secondRaw);
  assert.equal(records.length, 1);
  assert.equal(records[0].tokenHash, hashToken(secondRaw));
  assert.notEqual(records[0].tokenHash, secondRaw);
});

test("a valid token is consumed exactly once", async () => {
  const userId = new mongoose.Types.ObjectId();
  const raw = await issueAuthToken(userId, TOKEN_TYPES.PASSWORD_RESET, {
    tokenVersion: 0,
  });

  const firstUse = await consumeAuthToken(raw, TOKEN_TYPES.PASSWORD_RESET);
  const secondUse = await consumeAuthToken(raw, TOKEN_TYPES.PASSWORD_RESET);

  assert.equal(firstUse.userId.toString(), userId.toString());
  assert.equal(secondUse, null);
});

test("parallel claims allow one user and a released exact claim can retry", async () => {
  const userId = new mongoose.Types.ObjectId();
  const raw = await issueAuthToken(userId, TOKEN_TYPES.EMAIL_VERIFICATION);

  const claims = await Promise.all([
    claimAuthToken(raw, TOKEN_TYPES.EMAIL_VERIFICATION),
    claimAuthToken(raw, TOKEN_TYPES.EMAIL_VERIFICATION),
  ]);
  const winners = claims.filter(Boolean);

  assert.equal(winners.length, 1);
  await releaseAuthToken(winners[0]);
  const retry = await claimAuthToken(raw, TOKEN_TYPES.EMAIL_VERIFICATION);
  assert.ok(retry);
  await completeAuthToken(retry);
  assert.equal(await claimAuthToken(raw, TOKEN_TYPES.EMAIL_VERIFICATION), null);
});

test("releasing an old exact claim never changes a replacement token", async () => {
  const userId = new mongoose.Types.ObjectId();
  const oldRaw = await issueAuthToken(userId, TOKEN_TYPES.EMAIL_VERIFICATION);
  const oldClaim = await claimAuthToken(oldRaw, TOKEN_TYPES.EMAIL_VERIFICATION);

  const newRaw = await issueAuthToken(userId, TOKEN_TYPES.EMAIL_VERIFICATION);
  await releaseAuthToken(oldClaim);

  assert.equal(await claimAuthToken(oldRaw, TOKEN_TYPES.EMAIL_VERIFICATION), null);
  assert.ok(await claimAuthToken(newRaw, TOKEN_TYPES.EMAIL_VERIFICATION));
});

test("expired and malformed tokens are rejected", async () => {
  const raw = "a".repeat(64);
  await AuthToken.create({
    userId: new mongoose.Types.ObjectId(),
    type: TOKEN_TYPES.EMAIL_VERIFICATION,
    tokenHash: hashToken(raw),
    expiresAt: new Date(Date.now() - 1000),
  });

  assert.equal(await consumeAuthToken(raw, TOKEN_TYPES.EMAIL_VERIFICATION), null);
  assert.throws(() => hashToken("not-a-token"), /64 lowercase hexadecimal/);
});
