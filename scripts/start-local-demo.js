const { randomBytes: nodeRandomBytes } = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");

const API_PORT = 5000;
const CLIENT_PORT = 5173;
const API_URL = `http://localhost:${API_PORT}`;
const HEALTH_URL = `http://127.0.0.1:${API_PORT}/api/health`;
const CLIENT_URL = `http://localhost:${CLIENT_PORT}`;
const DEMO_CREDENTIALS = Object.freeze({
  customer: Object.freeze({
    username: "customer_demo",
    email: "customer.demo@example.com",
    password: "CustomerDemo#2026",
  }),
  admin: Object.freeze({
    username: "admin_demo",
    email: "admin.demo@example.com",
    password: "AdminDemo#2026",
  }),
});

function assertNodeVersion(version = process.versions.node) {
  const major = Number(String(version).split(".")[0]);
  if (!Number.isInteger(major) || major < 24 || major >= 25) {
    throw new Error(`Node.js >=24 <25 is required (found ${version})`);
  }
}

function buildDemoEnvironment(options = {}) {
  const baseEnv = options.baseEnv || process.env;
  return {
    ...baseEnv,
    NODE_ENV: "development",
    PORT: String(API_PORT),
    MONGO_URI: options.MONGO_URI,
    CLIENT_URL,
    JWT_SECRET: options.JWT_SECRET,
    JWT_EXPIRES_IN: "8h",
    GMAIL_USER: "local-demo@example.invalid",
    GMAIL_APP_PASSWORD: "not-used-in-local-demo",
    ENABLE_DEMO_SEED: "true",
    VITE_API_URL: `${API_URL}/api`,
  };
}

function npmExecutable(platform = process.platform) {
  return platform === "win32" ? "npm.cmd" : "npm";
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, { ...options, stdio: "inherit" });
    } catch (error) {
      reject(error);
      return;
    }
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed (${signal || `exit code ${code}`})`));
    });
  });
}

async function ensureDependencies({
  projects,
  platform = process.platform,
  exists = fs.existsSync,
  runCommand: execute = runCommand,
}) {
  const npm = npmExecutable(platform);
  const shellOptions = platform === "win32" ? { shell: true } : {};
  for (const project of projects) {
    if (!exists(path.join(project.directory, project.sentinel))) {
      await execute(npm, ["ci"], { cwd: project.directory, env: undefined, ...shellOptions });
    }
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForHealth(url, options = {}) {
  const attempts = options.attempts || 100;
  const intervalMs = options.intervalMs || 250;
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`health endpoint returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await wait(intervalMs);
  }
  throw new Error(`Server did not become healthy at ${url}: ${lastError?.message || "no response"}`);
}

function assertPortAvailable(port, host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", (error) => {
      if (error.code === "EADDRINUSE") {
        reject(new Error(`Local demo cannot start: port ${port} is already in use.`));
        return;
      }
      reject(error);
    });
    probe.listen(port, host, () => probe.close(resolve));
  });
}

async function assertPortsAvailable() {
  await assertPortAvailable(API_PORT);
  await assertPortAvailable(CLIENT_PORT);
}

function replSetOptionsForPlatform(platform = process.platform) {
  return {
    replSet: {
      count: 1,
      storageEngine: "wiredTiger",
      args: platform === "win32" ? [] : ["--nounixsocket"],
    },
  };
}

function createInMemoryReplSet(serverDirectory, platform) {
  const { MongoMemoryReplSet } = require(path.join(
    serverDirectory,
    "node_modules",
    "mongodb-memory-server",
  ));
  return MongoMemoryReplSet.create(replSetOptionsForPlatform(platform));
}

function stopChild(child) {
  if (!child || child.killed || typeof child.kill !== "function") return;
  try {
    child.kill("SIGTERM");
  } catch {}
}

function processFailure(child, label) {
  if (!child || typeof child.once !== "function") {
    return new Promise(() => {});
  }
  return new Promise((_, reject) => {
    child.once("error", (error) => reject(error));
    child.once("exit", (code, signal) =>
      reject(new Error(`${label} exited before startup completed (${signal || `exit code ${code}`})`)),
    );
  });
}

function printReady(logger) {
  logger.log("\nLocal Vehicle Service Booking demo is ready.");
  logger.log(`Frontend: ${CLIENT_URL}`);
  logger.log(`API health: ${API_URL}/api/health`);
  logger.log("\nDemo customer credentials:");
  logger.log(`  Username: ${DEMO_CREDENTIALS.customer.username}`);
  logger.log(`  Email: ${DEMO_CREDENTIALS.customer.email}`);
  logger.log(`  Password: ${DEMO_CREDENTIALS.customer.password}`);
  logger.log("Demo administrator credentials:");
  logger.log(`  Username: ${DEMO_CREDENTIALS.admin.username}`);
  logger.log(`  Email: ${DEMO_CREDENTIALS.admin.email}`);
  logger.log(`  Password: ${DEMO_CREDENTIALS.admin.password}`);
  logger.log("Press Ctrl+C to stop the demo.");
}

function createLauncher(options = {}) {
  const rootDir = options.rootDir || path.resolve(__dirname, "..");
  const serverDirectory = path.join(rootDir, "server");
  const clientDirectory = path.join(rootDir, "client");
  const serverEntry = path.join(serverDirectory, "index.js");
  const bookingSeedEntry = path.join(serverDirectory, "scripts", "seed-booking-foundation.js");
  const demoSeedEntry = options.accountSeedEntry || path.join(serverDirectory, "scripts", "seed-demo.js");
  const viteEntry = path.join(clientDirectory, "node_modules", "vite", "bin", "vite.js");
  const logger = options.logger || console;
  const runtime = options.runtime || process;
  const randomBytes = options.randomBytes || nodeRandomBytes;
  const startProcess = options.startProcess || ((command, args, spawnOptions) =>
    spawn(command, args, { ...spawnOptions, stdio: "inherit" }));
  const execute = options.runCommand || runCommand;
  const createReplSet = options.createReplSet || (() =>
    createInMemoryReplSet(serverDirectory, options.platform));
  const probeHealth = options.waitForHealth || waitForHealth;
  const preflightPorts = options.assertPortsAvailable || assertPortsAvailable;
  const checkNode = options.assertNodeVersion || assertNodeVersion;
  const exists = options.exists || fs.existsSync;
  const platform = options.platform || process.platform;
  const nodeExecutable = options.nodeExecutable || process.execPath;
  let replset;
  let serverChild;
  let clientChild;
  let stopping = false;
  let signalHandlersInstalled = false;

  async function stop() {
    if (stopping) return;
    stopping = true;
    stopChild(clientChild);
    stopChild(serverChild);
    if (replset) {
      if (options.persistent) await replset.stop({ doCleanup: false, force: false });
      else await replset.stop();
    }
    if (signalHandlersInstalled && typeof runtime.removeListener === "function") {
      runtime.removeListener("SIGINT", handleSignal);
      runtime.removeListener("SIGTERM", handleSignal);
    }
  }

  function handleSignal() {
    void stop().finally(() => {
      runtime.exitCode = 0;
    });
  }

  function installSignalHandlers() {
    if (options.installSignalHandlers === false || typeof runtime.once !== "function") return;
    runtime.once("SIGINT", handleSignal);
    runtime.once("SIGTERM", handleSignal);
    signalHandlersInstalled = true;
  }

  async function start() {
    try {
      checkNode();
      await ensureDependencies({
        projects: [
          {
            directory: serverDirectory,
            sentinel: "node_modules/mongodb-memory-server/package.json",
          },
          { directory: clientDirectory, sentinel: "node_modules/vite/package.json" },
        ],
        platform,
        exists,
        runCommand: execute,
      });
      await preflightPorts();
      replset = await createReplSet(replSetOptionsForPlatform(options.platform));
      const defaultEnvironment = buildDemoEnvironment({
        baseEnv: runtime.env || process.env,
        MONGO_URI: replset.getUri(options.databaseName || "vehicle_service_booking_demo"),
        JWT_SECRET: randomBytes(48).toString("hex"),
      });
      const environment = options.configureEnvironment ? options.configureEnvironment(defaultEnvironment) : defaultEnvironment;
      serverChild = startProcess(nodeExecutable, [serverEntry], {
        cwd: serverDirectory,
        env: environment,
      });
      await Promise.race([
        probeHealth(HEALTH_URL),
        processFailure(serverChild, "Server"),
      ]);
      await execute(nodeExecutable, [bookingSeedEntry], {
        cwd: serverDirectory,
        env: environment,
      });
      await execute(nodeExecutable, [demoSeedEntry], {
        cwd: serverDirectory,
        env: environment,
      });
      clientChild = startProcess(nodeExecutable, [viteEntry, "--host", "127.0.0.1", "--port", String(CLIENT_PORT), "--strictPort"], {
        cwd: clientDirectory,
        env: environment,
      });
      await Promise.race([
        probeHealth(`http://127.0.0.1:${CLIENT_PORT}`),
        processFailure(clientChild, "Vite"),
      ]);
      if (options.onReady) options.onReady();
      else printReady(logger);
      installSignalHandlers();
    } catch (error) {
      await stop();
      throw error;
    }
  }

  return { start, stop };
}

if (require.main === module) {
  const launcher = createLauncher();
  void launcher.start().catch((error) => {
    console.error(`Local demo startup failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  API_PORT,
  CLIENT_PORT,
  DEMO_CREDENTIALS,
  assertNodeVersion,
  assertPortAvailable,
  assertPortsAvailable,
  buildDemoEnvironment,
  createLauncher,
  ensureDependencies,
  replSetOptionsForPlatform,
  waitForHealth,
};
