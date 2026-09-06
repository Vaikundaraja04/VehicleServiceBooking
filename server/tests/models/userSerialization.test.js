const test = require("node:test");
const assert = require("node:assert/strict");

const User = require("../../models/User");

test("direct User JSON serialization removes passwordHash and tokenVersion", () => {
  const user = new User({
    username: "durai_03",
    email: "durai3@example.com",
    mobile: "9876543210",
    address: "Chennai",
    passwordHash: "loaded-password-hash",
    tokenVersion: 4,
    role: "customer",
  });

  const serialized = JSON.parse(JSON.stringify(user));

  assert.equal(Object.hasOwn(serialized, "passwordHash"), false);
  assert.equal(Object.hasOwn(serialized, "tokenVersion"), false);
});
