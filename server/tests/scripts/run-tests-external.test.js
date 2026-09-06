const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const test = require("node:test");

const {
  runExternalTests,
  validateExternalTestEnvironment,
} = require("../../scripts/run-tests-external");

const COMPOSE_URI =
  "mongodb://mongo:27017/vehicle_service_booking_test?replicaSet=rs0";
const DATABASE_ENV_NAMES = [
  "MONGO_URI_TEST",
  "MONGO_URI",
  "TEST_DATABASE_URI",
];

test("release package scripts use guarded runners and the Node 24 engine", () => {
  const serverPackage = require("../../package.json");
  const clientPackage = require("../../../client/package.json");

  assert.equal(serverPackage.engines?.node, ">=24 <25");
  assert.equal(clientPackage.engines?.node, ">=24 <25");
  assert.deepEqual(
    {
      lint: serverPackage.scripts.lint,
      seedBooking: serverPackage.scripts["seed:booking"],
      testExternal: serverPackage.scripts["test:external"],
      testRace: serverPackage.scripts["test:race"],
      testRaceExternal: serverPackage.scripts["test:race:external"],
      testAll: serverPackage.scripts["test:all"],
      testAllExternal: serverPackage.scripts["test:all:external"],
    },
    {
      lint: "eslint .",
      seedBooking: "node scripts/seed-booking-foundation.js",
      testExternal: "node scripts/run-tests-external.js",
      testRace: "npm test -- tests/services/bookingService.race.test.js",
      testRaceExternal:
        "npm run test:external -- tests/services/bookingService.race.test.js",
      testAll: "npm run lint && npm test",
      testAllExternal: "npm run lint && npm run test:external",
    },
  );
});

test("server lockfile records the pinned ESLint 10 release", () => {
  const serverPackage = require("../../package.json");
  const serverLock = require("../../package-lock.json");

  assert.equal(serverPackage.devDependencies.eslint, "10.9.1");
  assert.equal(serverLock.packages[""].devDependencies.eslint, "10.9.1");
  assert.equal(serverLock.packages["node_modules/eslint"].version, "10.9.1");
});

function safeEnvironment(overrides = {}) {
  return {
    PATH: process.env.PATH,
    MONGO_URI_TEST: COMPOSE_URI,
    MONGO_URI: COMPOSE_URI,
    TEST_DATABASE_URI: COMPOSE_URI,
    ...overrides,
  };
}

function fakeProcess() {
  const processLike = new EventEmitter();
  processLike.execPath = "/opt/node/bin/node";
  processLike.exitCode = undefined;
  return processLike;
}

function fakeChild() {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.killedWith = [];
  child.kill = (signal) => {
    child.killedWith.push(signal);
    return true;
  };
  return child;
}

test("rejects every missing database URI before spawning the test process", async (t) => {
  for (const missingName of DATABASE_ENV_NAMES) {
    await t.test(missingName, async () => {
      const environment = safeEnvironment();
      delete environment[missingName];
      let spawnCalls = 0;

      await assert.rejects(
        runExternalTests({
          environment,
          spawnProcess: () => {
            spawnCalls += 1;
          },
        }),
        /all be present and identical/i,
      );
      assert.equal(spawnCalls, 0);
    });
  }
});

test("rejects mismatched database URIs before spawning the test process", async () => {
  let spawnCalls = 0;
  const environment = safeEnvironment({
    MONGO_URI: COMPOSE_URI.replace("mongo:27017", "other:27017"),
  });

  await assert.rejects(
    runExternalTests({
      environment,
      spawnProcess: () => {
        spawnCalls += 1;
      },
    }),
    /all be present and identical/i,
  );
  assert.equal(spawnCalls, 0);
});

test("rejects a development database before spawning the test process", async () => {
  let spawnCalls = 0;
  const developmentUri =
    "mongodb://mongo:27017/vehicle_service_booking?replicaSet=rs0";

  await assert.rejects(
    runExternalTests({
      environment: safeEnvironment(
        Object.fromEntries(
          DATABASE_ENV_NAMES.map((name) => [name, developmentUri]),
        ),
      ),
      spawnProcess: () => {
        spawnCalls += 1;
      },
    }),
    /unsafe test database/i,
  );
  assert.equal(spawnCalls, 0);
});

test("rejects a test database that is not configured for rs0 before spawning", async () => {
  let spawnCalls = 0;
  const standaloneUri =
    "mongodb://mongo:27017/vehicle_service_booking_test?replicaSet=other";

  await assert.rejects(
    runExternalTests({
      environment: safeEnvironment(
        Object.fromEntries(
          DATABASE_ENV_NAMES.map((name) => [name, standaloneUri]),
        ),
      ),
      spawnProcess: () => {
        spawnCalls += 1;
      },
    }),
    /replicaSet=rs0/i,
  );
  assert.equal(spawnCalls, 0);
});

test("accepts the exact Compose test URI", () => {
  assert.equal(validateExternalTestEnvironment(safeEnvironment()), COMPOSE_URI);
});

test("spawns the guarded Node test command and forwards caller arguments", async () => {
  const child = fakeChild();
  const processLike = fakeProcess();
  const calls = [];
  const environment = safeEnvironment({ RELEASE_EVIDENCE: "safe" });

  const resultPromise = runExternalTests({
    args: ["tests/services/bookingService.race.test.js", "--test-name-pattern=race"],
    environment,
    processLike,
    spawnProcess: (...call) => {
      calls.push(call);
      return child;
    },
  });
  child.emit("close", 0, null);

  assert.equal(await resultPromise, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], processLike.execPath);
  assert.deepEqual(calls[0][1], [
    "--require",
    "./tests/test-env.js",
    "--test",
    "--test-concurrency=1",
    "tests/services/bookingService.race.test.js",
    "--test-name-pattern=race",
  ]);
  assert.deepEqual(calls[0][2], {
    cwd: path.join(__dirname, "..", ".."),
    env: environment,
    stdio: "inherit",
  });
  assert.equal(processLike.listenerCount("SIGINT"), 0);
  assert.equal(processLike.listenerCount("SIGTERM"), 0);
});

test("preserves a non-zero child exit status", async () => {
  const child = fakeChild();
  const resultPromise = runExternalTests({
    environment: safeEnvironment(),
    processLike: fakeProcess(),
    spawnProcess: () => child,
  });
  child.emit("close", 23, null);

  assert.equal(await resultPromise, 23);
});

for (const [signal, expectedStatus] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
]) {
  test(`forwards ${signal} to the child and returns its conventional status`, async () => {
    const child = fakeChild();
    const processLike = fakeProcess();
    const resultPromise = runExternalTests({
      environment: safeEnvironment(),
      processLike,
      spawnProcess: () => child,
    });

    processLike.emit(signal);
    assert.deepEqual(child.killedWith, [signal]);
    child.signalCode = signal;
    child.emit("close", null, signal);

    assert.equal(await resultPromise, expectedStatus);
    assert.equal(processLike.listenerCount("SIGINT"), 0);
    assert.equal(processLike.listenerCount("SIGTERM"), 0);
  });
}
