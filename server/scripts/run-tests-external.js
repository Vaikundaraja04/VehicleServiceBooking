const { spawn } = require("node:child_process");
const path = require("node:path");

const DATABASE_ENV_NAMES = [
  "MONGO_URI_TEST",
  "MONGO_URI",
  "TEST_DATABASE_URI",
];
const SIGNAL_EXIT_STATUS = {
  SIGINT: 130,
  SIGTERM: 143,
};

function validateExternalTestEnvironment(environment = process.env) {
  const values = DATABASE_ENV_NAMES.map((name) => environment[name]);

  if (values.some((value) => !value) || new Set(values).size !== 1) {
    throw new Error("External test database URIs must all be present and identical");
  }

  let parsed;
  try {
    parsed = new URL(values[0]);
  } catch {
    throw new Error("External test database URI is invalid");
  }

  if (!['mongodb:', 'mongodb+srv:'].includes(parsed.protocol)) {
    throw new Error("External test database URI must use MongoDB");
  }
  if (parsed.pathname !== "/vehicle_service_booking_test") {
    throw new Error("Refusing unsafe test database");
  }
  if (parsed.searchParams.get("replicaSet") !== "rs0") {
    throw new Error("External test URI must use replicaSet=rs0");
  }

  return values[0];
}

function exitStatus(code, signal) {
  if (Number.isInteger(code)) return code;
  return SIGNAL_EXIT_STATUS[signal] ?? 1;
}

async function runExternalTests({
  args = process.argv.slice(2),
  environment = process.env,
  processLike = process,
  spawnProcess = spawn,
} = {}) {
  validateExternalTestEnvironment(environment);

  const child = spawnProcess(
    processLike.execPath,
    [
      "--require",
      "./tests/test-env.js",
      "--test",
      "--test-concurrency=1",
      ...args,
    ],
    {
      cwd: path.join(__dirname, ".."),
      env: environment,
      stdio: "inherit",
    },
  );

  const forwardSignal = (signal) => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill(signal);
    }
  };
  const forwardSigint = () => forwardSignal("SIGINT");
  const forwardSigterm = () => forwardSignal("SIGTERM");

  processLike.once("SIGINT", forwardSigint);
  processLike.once("SIGTERM", forwardSigterm);

  try {
    return await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve(exitStatus(code, signal)));
    });
  } finally {
    processLike.removeListener("SIGINT", forwardSigint);
    processLike.removeListener("SIGTERM", forwardSigterm);
  }
}

async function main() {
  process.exitCode = await runExternalTests();
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  main,
  runExternalTests,
  validateExternalTestEnvironment,
};
