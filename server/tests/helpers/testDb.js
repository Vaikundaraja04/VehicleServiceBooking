const mongoose = require("mongoose");

function validateTestDatabaseUri(uri) {
  const parsed = new URL(uri);
  if (parsed.pathname !== "/vehicle_service_booking_test") {
    throw new Error("Refusing unsafe test database");
  }
  if (parsed.searchParams.get("replicaSet") !== "rs0") {
    throw new Error("Test URI must use replicaSet=rs0");
  }
}

async function assertReplicaSet({ admin = mongoose.connection.db.admin() } = {}) {
  const hello = await admin.command({ hello: 1 });
  if (hello.setName !== "rs0" || !hello.isWritablePrimary) {
    throw new Error("Booking tests require writable MongoDB replica set rs0");
  }
}

async function connectTestDb() {
  const { MONGO_URI_TEST: uri, TEST_DATABASE_URI, MONGO_URI } = process.env;
  if (
    !uri ||
    !TEST_DATABASE_URI ||
    !MONGO_URI ||
    uri !== TEST_DATABASE_URI ||
    uri !== MONGO_URI
  ) {
    throw new Error("Test database URIs must all be present and identical");
  }
  validateTestDatabaseUri(uri);

  const { readyState } = mongoose.connection;
  if (readyState === 2 || readyState === 3) {
    throw new Error("Refusing transitional MongoDB state for booking tests");
  }
  if (readyState !== 0 && readyState !== 1) {
    throw new Error("Refusing unsafe MongoDB connection state for booking tests");
  }

  if (readyState === 0) {
    await mongoose.connect(uri);
  }
  if (mongoose.connection.name !== "vehicle_service_booking_test") {
    throw new Error(
      `Refusing unsafe connected test database: ${mongoose.connection.name}`,
    );
  }
  await assertReplicaSet();
}

async function clearTestDb() {
  const databaseName = mongoose.connection.name;
  if (databaseName !== "vehicle_service_booking_test") {
    throw new Error(`Refusing to clear unsafe database: ${databaseName}`);
  }

  await Promise.all(
    Object.values(mongoose.connection.collections).map((collection) =>
      collection.deleteMany({}),
    ),
  );
}

async function disconnectTestDb() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

module.exports = {
  assertReplicaSet,
  clearTestDb,
  connectTestDb,
  disconnectTestDb,
  validateTestDatabaseUri,
};
