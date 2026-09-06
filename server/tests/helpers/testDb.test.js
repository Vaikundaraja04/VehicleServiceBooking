const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const mongoose = require("mongoose");

const {
  assertReplicaSet,
  clearTestDb,
  connectTestDb,
  disconnectTestDb,
  validateTestDatabaseUri,
} = require("./testDb");

const SAFE_URI =
  "mongodb://127.0.0.1:41001/vehicle_service_booking_test?replicaSet=rs0";
const DATABASE_ENV_NAMES = [
  "MONGO_URI_TEST",
  "TEST_DATABASE_URI",
  "MONGO_URI",
];

function restoreDatabaseEnvironment(originalEnvironment) {
  for (const name of DATABASE_ENV_NAMES) {
    if (originalEnvironment[name] === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = originalEnvironment[name];
    }
  }
}

async function withConnectionState({ readyState, name, db }, operation) {
  const originalState = mongoose.connection.readyState;
  const originalName = mongoose.connection.name;
  const originalDb = mongoose.connection.db;

  mongoose.connection.readyState = readyState;
  mongoose.connection.name = name;
  mongoose.connection.db = db;

  try {
    await operation();
  } finally {
    mongoose.connection.readyState = originalState;
    mongoose.connection.name = originalName;
    mongoose.connection.db = originalDb;
  }
}

test("validateTestDatabaseUri accepts an isolated rs0 test database on a dynamic port", () => {
  assert.doesNotThrow(() =>
    validateTestDatabaseUri(
      "mongodb://127.0.0.1:41001/vehicle_service_booking_test?replicaSet=rs0",
    ),
  );
});

test("validateTestDatabaseUri rejects a non-test database", () => {
  assert.throws(
    () =>
      validateTestDatabaseUri(
        "mongodb://127.0.0.1:27017/vehicle_service_booking",
      ),
    /unsafe test database/i,
  );
});

test("validateTestDatabaseUri requires replica set rs0", () => {
  assert.throws(
    () =>
      validateTestDatabaseUri(
        "mongodb://127.0.0.1:27017/vehicle_service_booking_test",
      ),
    /replicaSet=rs0/i,
  );
});

test("assertReplicaSet accepts a writable rs0 primary", async () => {
  await assert.doesNotReject(
    assertReplicaSet({
      admin: {
        command: async () => ({ setName: "rs0", isWritablePrimary: true }),
      },
    }),
  );
});

test("assertReplicaSet rejects a writable primary from the wrong replica set", async () => {
  await assert.rejects(
    assertReplicaSet({
      admin: {
        command: async () => ({
          setName: "other",
          isWritablePrimary: true,
        }),
      },
    }),
    /writable MongoDB replica set rs0/i,
  );
});

test("assertReplicaSet rejects a non-writable rs0 member", async () => {
  await assert.rejects(
    assertReplicaSet({
      admin: {
        command: async () => ({
          setName: "rs0",
          isWritablePrimary: false,
        }),
      },
    }),
    /writable MongoDB replica set rs0/i,
  );
});

test("connectTestDb rejects a non-test URI before attempting a MongoDB connection", async () => {
  const originalEnvironment = Object.fromEntries(
    DATABASE_ENV_NAMES.map((name) => [name, process.env[name]]),
  );
  const originalConnect = mongoose.connect;
  let connectionAttempts = 0;

  for (const name of DATABASE_ENV_NAMES) {
    process.env[name] = "mongodb://127.0.0.1:27017/vehicle_service_booking";
  }
  mongoose.connect = async () => {
    connectionAttempts += 1;
    throw new Error("mongoose.connect must not run for an unsafe URI");
  };

  try {
    await assert.rejects(
      connectTestDb(),
      /unsafe test database/i,
    );
    assert.equal(connectionAttempts, 0);
  } finally {
    mongoose.connect = originalConnect;
    restoreDatabaseEnvironment(originalEnvironment);
  }
});

test("connectTestDb rejects every missing or mismatched database URI before connecting", async (t) => {
  const cases = [
    { name: "missing MONGO_URI_TEST", missing: "MONGO_URI_TEST" },
    { name: "missing TEST_DATABASE_URI", missing: "TEST_DATABASE_URI" },
    { name: "missing MONGO_URI", missing: "MONGO_URI" },
    {
      name: "mismatched MONGO_URI_TEST",
      mismatched: "MONGO_URI_TEST",
    },
    {
      name: "mismatched TEST_DATABASE_URI",
      mismatched: "TEST_DATABASE_URI",
    },
    { name: "mismatched MONGO_URI", mismatched: "MONGO_URI" },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      const originalEnvironment = Object.fromEntries(
        DATABASE_ENV_NAMES.map((name) => [name, process.env[name]]),
      );
      const originalConnect = mongoose.connect;
      let connectionAttempts = 0;

      for (const name of DATABASE_ENV_NAMES) process.env[name] = SAFE_URI;
      if (testCase.missing) delete process.env[testCase.missing];
      if (testCase.mismatched) {
        process.env[testCase.mismatched] = SAFE_URI.replace("41001", "41002");
      }
      mongoose.connect = async () => {
        connectionAttempts += 1;
        throw new Error("mongoose.connect must not run for URI disagreement");
      };

      try {
        await assert.rejects(
          connectTestDb(),
          /database URIs must all be present and identical/i,
        );
        assert.equal(connectionAttempts, 0);
      } finally {
        mongoose.connect = originalConnect;
        restoreDatabaseEnvironment(originalEnvironment);
      }
    });
  }
});

test("test-env preserves a preconfigured MONGO_URI disagreement", () => {
  const mismatchedUri = SAFE_URI.replace("41001", "41002");
  const child = spawnSync(
    process.execPath,
    [
      "--require",
      "./tests/test-env.js",
      "--eval",
      "process.stdout.write(process.env.MONGO_URI)",
    ],
    {
      cwd: path.join(__dirname, "..", ".."),
      encoding: "utf8",
      env: {
        ...process.env,
        MONGO_URI_TEST: SAFE_URI,
        TEST_DATABASE_URI: SAFE_URI,
        MONGO_URI: mismatchedUri,
      },
    },
  );

  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, mismatchedUri);
});

test("connectTestDb rejects an open connection to the wrong database", async () => {
  const originalConnect = mongoose.connect;
  let connectionAttempts = 0;
  mongoose.connect = async () => {
    connectionAttempts += 1;
  };

  try {
    await withConnectionState(
      {
        readyState: 1,
        name: "vehicle_service_booking",
        db: {
          admin: () => ({
            command: async () => ({
              setName: "rs0",
              isWritablePrimary: true,
            }),
          }),
        },
      },
      async () => {
        await assert.rejects(connectTestDb(), /unsafe connected test database/i);
        assert.equal(connectionAttempts, 0);
      },
    );
  } finally {
    mongoose.connect = originalConnect;
  }
});

for (const [readyState, label] of [
  [2, "connecting"],
  [3, "disconnecting"],
]) {
  test(`connectTestDb rejects the transitional ${label} state`, async () => {
    const originalConnect = mongoose.connect;
    let connectionAttempts = 0;
    mongoose.connect = async () => {
      connectionAttempts += 1;
    };

    try {
      await withConnectionState(
        {
          readyState,
          name: "vehicle_service_booking_test",
          db: {
            admin: () => ({
              command: async () => ({
                setName: "rs0",
                isWritablePrimary: true,
              }),
            }),
          },
        },
        async () => {
          await assert.rejects(connectTestDb(), /transitional MongoDB state/i);
          assert.equal(connectionAttempts, 0);
        },
      );
    } finally {
      mongoose.connect = originalConnect;
    }
  });
}

test("clearTestDb rejects an unsafe connected database name before deletion", async () => {
  const originalName = mongoose.connection.name;
  mongoose.connection.name = "vehicle_service_booking";

  try {
    await assert.rejects(clearTestDb(), /Refusing to clear unsafe database/);
  } finally {
    mongoose.connection.name = originalName;
  }
});

test("connectTestDb uses the live runner replica and clears only the test database", async (t) => {
  t.after(disconnectTestDb);

  await connectTestDb();
  assert.equal(mongoose.connection.name, "vehicle_service_booking_test");

  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  assert.equal(hello.setName, "rs0");
  assert.equal(hello.isWritablePrimary, true);

  const collection = mongoose.connection.collection("test_db_helper_live");
  await collection.insertOne({ marker: "clear-me" });
  assert.equal(await collection.countDocuments({}), 1);

  await clearTestDb();
  assert.equal(await collection.countDocuments({}), 0);
});
