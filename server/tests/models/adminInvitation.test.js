const test = require("node:test");
const assert = require("node:assert/strict");

test("administrator invitations persist only a hashed, bound, expiring single-use record", async () => {
  const AdminInvitation = require("../../models/AdminInvitation");
  const invitation = new AdminInvitation({
    invitedEmail: " INVITED@EXAMPLE.COM ",
    tokenHash: "f".repeat(64),
    invitedBy: "507f1f77bcf86cd799439011",
    expiresAt: new Date("2026-08-27T12:00:00.000Z"),
  });

  await invitation.validate();
  assert.equal(invitation.invitedEmail, "invited@example.com");
  assert.equal(invitation.tokenHash, "f".repeat(64));
  assert.equal(invitation.usedAt, null);
  assert.equal(Object.hasOwn(invitation.toObject(), "token"), false);
  assert.equal(Object.hasOwn(invitation.toObject(), "rawToken"), false);

  const indexes = AdminInvitation.schema.indexes();
  const invitedEmailOnlyIndexes = indexes.filter(
    ([fields]) =>
      Object.keys(fields).length === 1 &&
      fields.invitedEmail === 1,
  );
  assert.equal(invitedEmailOnlyIndexes.length, 1);
  assert.ok(
    invitedEmailOnlyIndexes.some(
      ([fields, options]) =>
        fields.invitedEmail === 1 &&
        options.unique === true &&
        options.partialFilterExpression?.usedAt === null,
    ),
  );
  assert.ok(
    indexes.some(
      ([fields, options]) => fields.expiresAt === 1 && options.expireAfterSeconds === 0,
    ),
  );
});
