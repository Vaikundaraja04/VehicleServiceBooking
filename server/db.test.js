const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const {
  assertReplicaSet,
  validateTestDatabaseUri,
} = require("./tests/helpers/testDb");

test("connectDB connects to the guarded replica-set test database", async (t) => {
  const { MONGO_URI_TEST, MONGO_URI, TEST_DATABASE_URI } = process.env;

  assert.equal(MONGO_URI, MONGO_URI_TEST);
  assert.equal(MONGO_URI, TEST_DATABASE_URI);
  validateTestDatabaseUri(MONGO_URI);

  let connectDB;
  try {
    connectDB = require("./config/db");
  } catch (error) {
    if (error.code !== "MODULE_NOT_FOUND") {
      throw error;
    }
  }
  assert.equal(typeof connectDB, "function");

  t.after(async () => {
    await mongoose.disconnect();
  });

  await connectDB();

  assert.equal(mongoose.connection.readyState, 1);
  assert.equal(mongoose.connection.name, "vehicle_service_booking_test");
  await assertReplicaSet();
});
