const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");

const runnerPath = path.join(
  __dirname,
  "..",
  "..",
  "scripts",
  "run-tests-with-replset.js",
);

test("importing the replica-set runner does not start MongoDB", async () => {
  const originalLoad = Module._load;
  let createCalls = 0;

  Module._load = function loadWithoutMongo(request, parent, isMain) {
    if (request === "mongodb-memory-server") {
      return {
        MongoMemoryReplSet: {
          create: async () => {
            createCalls += 1;
            return new Promise(() => {});
          },
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[runnerPath];

  try {
    require(runnerPath);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(createCalls, 0);
  } finally {
    delete require.cache[runnerPath];
    Module._load = originalLoad;
  }
});

test("non-Windows replica-set members disable only the Unix socket listener", () => {
  const { replSetOptionsForPlatform } = require(runnerPath);
  const expected = {
    replSet: {
      name: "rs0",
      count: 1,
      storageEngine: "wiredTiger",
      args: ["--nounixsocket"],
    },
  };

  assert.deepEqual(replSetOptionsForPlatform("linux"), expected);
  assert.deepEqual(replSetOptionsForPlatform("darwin"), expected);
});

test("Windows replica-set members receive no Unix-only arguments", () => {
  const { replSetOptionsForPlatform } = require(runnerPath);

  assert.deepEqual(replSetOptionsForPlatform("win32"), {
    replSet: {
      name: "rs0",
      count: 1,
      storageEngine: "wiredTiger",
      args: [],
    },
  });
});
