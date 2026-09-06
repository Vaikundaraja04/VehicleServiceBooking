const { MongoMemoryReplSet } = require("mongodb-memory-server");
const { spawn } = require("node:child_process");
const path = require("node:path");

function replSetOptionsForPlatform(platform = process.platform) {
  return {
    replSet: {
      name: "rs0",
      count: 1,
      storageEngine: "wiredTiger",
      args: platform === "win32" ? [] : ["--nounixsocket"],
    },
  };
}

async function main() {
  const replSet = await MongoMemoryReplSet.create(
    replSetOptionsForPlatform(process.platform),
  );
  const uri = replSet.getUri("vehicle_service_booking_test");
  let child;

  const forwardSignal = (signal) => {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill(signal);
    }
  };
  const forwardSigint = () => forwardSignal("SIGINT");
  const forwardSigterm = () => forwardSignal("SIGTERM");

  process.once("SIGINT", forwardSigint);
  process.once("SIGTERM", forwardSigterm);

  try {
    child = spawn(
      process.execPath,
      [
        "--require",
        "./tests/test-env.js",
        "--test",
        "--test-concurrency=1",
        ...process.argv.slice(2),
      ],
      {
        cwd: path.join(__dirname, ".."),
        stdio: "inherit",
        env: {
          ...process.env,
          MONGO_URI_TEST: uri,
          MONGO_URI: uri,
          TEST_DATABASE_URI: uri,
        },
      },
    );
    process.exitCode = await new Promise((resolve) =>
      child.once("close", (code) => resolve(code ?? 1)),
    );
  } finally {
    process.removeListener("SIGINT", forwardSigint);
    process.removeListener("SIGTERM", forwardSigterm);
    await replSet.stop();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { main, replSetOptionsForPlatform };
