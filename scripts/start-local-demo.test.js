const assert = require("node:assert/strict");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const net = require("node:net");
const test = require("node:test");

const {
  DEMO_CREDENTIALS,
  assertPortAvailable,
  buildDemoEnvironment,
  createLauncher,
  ensureDependencies,
  replSetOptionsForPlatform,
} = require("./start-local-demo");

test("buildDemoEnvironment supplies a complete safe development environment", () => {
  const environment = buildDemoEnvironment({
    MONGO_URI: "mongodb://127.0.0.1:27017/local-demo?replicaSet=rs0",
    JWT_SECRET: "x".repeat(64),
  });

  assert.equal(environment.NODE_ENV, "development");
  assert.equal(environment.PORT, "5000");
  assert.equal(environment.CLIENT_URL, "http://localhost:5173");
  assert.equal(environment.JWT_EXPIRES_IN, "8h");
  assert.equal(environment.VITE_API_URL, "http://localhost:5000/api");
  assert.equal(environment.GMAIL_USER, "local-demo@example.invalid");
  assert.equal(environment.GMAIL_APP_PASSWORD, "not-used-in-local-demo");
  assert.equal(environment.ENABLE_DEMO_SEED, "true");
  assert.equal(environment.MONGO_URI, "mongodb://127.0.0.1:27017/local-demo?replicaSet=rs0");
  assert.equal(environment.JWT_SECRET.length, 64);
});

test("port preflight reports a clear error before a demo can seed against another service", async () => {
  const occupied = net.createServer();
  await new Promise((resolve) => occupied.listen(0, "127.0.0.1", resolve));
  const port = occupied.address().port;
  try {
    await assert.rejects(assertPortAvailable(port), /port \d+ is already in use/);
  } finally {
    await new Promise((resolve) => occupied.close(resolve));
  }
});

test("replSetOptionsForPlatform avoids Unix sockets outside Windows", () => {
  assert.deepEqual(replSetOptionsForPlatform("linux"), {
    replSet: { count: 1, storageEngine: "wiredTiger", args: ["--nounixsocket"] },
  });
  assert.deepEqual(replSetOptionsForPlatform("darwin"), {
    replSet: { count: 1, storageEngine: "wiredTiger", args: ["--nounixsocket"] },
  });
  assert.deepEqual(replSetOptionsForPlatform("win32"), {
    replSet: { count: 1, storageEngine: "wiredTiger", args: [] },
  });
});

test("ensureDependencies runs npm ci only when a required dependency sentinel is missing", async () => {
  const calls = [];
  const existing = new Set([
    path.normalize("/project/server/node_modules/mongodb-memory-server/package.json"),
  ]);

  await ensureDependencies({
    projects: [
      {
        directory: path.normalize("/project/server"),
        sentinel: "node_modules/mongodb-memory-server/package.json",
      },
      { directory: path.normalize("/project/client"), sentinel: "node_modules/vite/package.json" },
    ],
    platform: "linux",
    exists: (target) => existing.has(path.normalize(target)),
    runCommand: async (...args) => calls.push(args),
  });

  assert.deepEqual(calls, [
    ["npm", ["ci"], { cwd: path.normalize("/project/client"), env: undefined }],
  ]);
});

test("Windows dependency installation invokes npm.cmd through a shell", async () => {
  const calls = [];

  await ensureDependencies({
    projects: [{ directory: "C:\\project\\client", sentinel: "node_modules/vite/package.json" }],
    platform: "win32",
    exists: () => false,
    runCommand: async (...args) => calls.push(args),
  });

  assert.deepEqual(calls, [
    ["npm.cmd", ["ci"], { cwd: "C:\\project\\client", env: undefined, shell: true }],
  ]);
});

test("Windows launcher uses direct Node child processes after dependency installation", async () => {
  const calls = [];
  const launcher = createLauncher({
    rootDir: "/project",
    platform: "win32",
    nodeExecutable: "node.exe",
    assertNodeVersion: () => {},
    assertPortsAvailable: async () => {},
    exists: () => true,
    createReplSet: async () => ({
      getUri: () => "mongodb://127.0.0.1:27017/local-demo?replicaSet=rs0",
      stop: async () => {},
    }),
    randomBytes: () => Buffer.alloc(48, 7),
    startProcess: (command, args, options) => {
      calls.push([command, args.map(arg => path.normalize(arg)), options.shell]);
      return {};
    },
    runCommand: async (command, args, options) => calls.push([command, args, options.shell]),
    waitForHealth: async () => {},
    logger: { log: () => {}, error: () => {} },
    installSignalHandlers: false,
  });

  await launcher.start();

  assert.deepEqual(calls, [
    ["node.exe", [path.normalize("/project/server/index.js")], undefined],
    ["node.exe", [path.normalize("/project/server/scripts/seed-booking-foundation.js")], undefined],
    ["node.exe", [path.normalize("/project/server/scripts/seed-demo.js")], undefined],
    ["node.exe", [path.normalize("/project/client/node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", "5173", "--strictPort"], undefined],
  ]);
});

test("server exit before API readiness rejects startup and cleans up", async () => {
  const events = [];
  const serverChild = new EventEmitter();
  serverChild.kill = () => events.push("server:kill");
  let serverStarted;
  const serverStartedPromise = new Promise((resolve) => { serverStarted = resolve; });
  const launcher = createLauncher({
    rootDir: "/project",
    assertNodeVersion: () => {},
    assertPortsAvailable: async () => {},
    exists: () => true,
    createReplSet: async () => ({
      getUri: () => "mongodb://127.0.0.1:27017/local-demo?replicaSet=rs0",
      stop: async () => events.push("replset:stop"),
    }),
    startProcess: () => {
      serverStarted();
      return serverChild;
    },
    waitForHealth: () => new Promise(() => {}),
    installSignalHandlers: false,
  });

  const starting = launcher.start();
  await serverStartedPromise;
  serverChild.emit("exit", 1, null);

  await assert.rejects(starting, /Server exited before startup completed/);
  assert.deepEqual(events, ["server:kill", "replset:stop"]);
});

test("Vite exit before client readiness rejects startup and cleans up", async () => {
  const events = [];
  const serverChild = new EventEmitter();
  const clientChild = new EventEmitter();
  serverChild.kill = () => events.push("server:kill");
  clientChild.kill = () => events.push("client:kill");
  const launcher = createLauncher({
    rootDir: "/project",
    assertNodeVersion: () => {},
    assertPortsAvailable: async () => {},
    exists: () => true,
    createReplSet: async () => ({
      getUri: () => "mongodb://127.0.0.1:27017/local-demo?replicaSet=rs0",
      stop: async () => events.push("replset:stop"),
    }),
    startProcess: (_command, args) => (args[0].endsWith("index.js") ? serverChild : clientChild),
    runCommand: async () => {},
    waitForHealth: (url) =>
      url.endsWith("/api/health") ? Promise.resolve() : new Promise(() => {}),
    installSignalHandlers: false,
  });

  const starting = launcher.start();
  await new Promise((resolve) => setImmediate(resolve));
  clientChild.emit("exit", 1, null);

  await assert.rejects(starting, /Vite exited before startup completed/);
  assert.deepEqual(events, ["client:kill", "server:kill", "replset:stop"]);
});

test("launcher starts a replset, waits for health, seeds, starts Vite, and reports exact credentials", async () => {
  const events = [];
  const serverChild = { kill: () => events.push("server:kill") };
  const clientChild = { kill: () => events.push("client:kill") };
  const replset = {
    getUri: (database) => `mongodb://127.0.0.1:27017/${database}?replicaSet=rs0`,
    stop: async () => events.push("replset:stop"),
  };
  const output = [];
  const launcher = createLauncher({
    rootDir: "/project",
    platform: process.platform === "win32" ? "win32" : "linux",
    nodeExecutable: "node",
    assertNodeVersion: () => events.push("node:checked"),
    exists: () => true,
    createReplSet: async (options) => {
      events.push(["replset:create", options]);
      return replset;
    },
    randomBytes: () => Buffer.alloc(48, 7),
    startProcess: (command, args, options) => {
      events.push(["start", command, args.map(arg => path.normalize(arg)), options.cwd, options.env]);
      return args[0].endsWith("index.js") ? serverChild : clientChild;
    },
    runCommand: async (command, args, options) =>
      events.push(["run", command, args, options.cwd, options.env]),
    waitForHealth: async (url) => events.push(["health", url]),
    logger: { log: (line) => output.push(line), error: (line) => output.push(line) },
    installSignalHandlers: false,
  });

  await launcher.start();

  assert.deepEqual(events.slice(0, 6).map((event) => Array.isArray(event) ? event.slice(0, 3) : event), [
    "node:checked",
    ["replset:create", { replSet: { count: 1, storageEngine: "wiredTiger", args: ["--nounixsocket"] } }],
    ["start", "node", ["/project/server/index.js"]],
    ["health", "http://127.0.0.1:5000/api/health"],
    ["run", "node", ["/project/server/scripts/seed-booking-foundation.js"]],
    ["run", "node", ["/project/server/scripts/seed-demo.js"]],
  ]);
  const serverEnvironment = events.find((event) => Array.isArray(event) && event[0] === "start")[4];
  assert.match(serverEnvironment.JWT_SECRET, /^[0-9a-f]{96}$/);
  assert.equal(serverEnvironment.MONGO_URI, "mongodb://127.0.0.1:27017/vehicle_service_booking_demo?replicaSet=rs0");
  assert.ok(output.some((line) => line.includes("http://localhost:5173")));
  assert.ok(output.some((line) => line.includes(DEMO_CREDENTIALS.customer.email)));
  assert.ok(output.some((line) => line.includes(DEMO_CREDENTIALS.customer.password)));
  assert.ok(output.some((line) => line.includes(DEMO_CREDENTIALS.admin.email)));
  assert.ok(output.some((line) => line.includes(DEMO_CREDENTIALS.admin.password)));
  const clientStart = events.filter((event) => Array.isArray(event) && event[0] === "start")[1];
  assert.deepEqual(clientStart[2], [path.normalize("/project/client/node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", "5173", "--strictPort"]);
  assert.deepEqual(
    events.filter((event) => Array.isArray(event) && event[0] === "health"),
    [
      ["health", "http://127.0.0.1:5000/api/health"],
      ["health", "http://127.0.0.1:5173"],
    ],
  );

  await launcher.stop();
  assert.deepEqual(events.slice(-3), ["client:kill", "server:kill", "replset:stop"]);
});

test("launcher cleans up the replset and propagates startup failure", async () => {
  const events = [];
  const expected = new Error("server did not become healthy");
  const launcher = createLauncher({
    rootDir: "/project",
    assertNodeVersion: () => {},
    exists: () => true,
    createReplSet: async () => ({
      getUri: () => "mongodb://127.0.0.1:27017/local-demo?replicaSet=rs0",
      stop: async () => events.push("replset:stop"),
    }),
    startProcess: () => ({ kill: () => events.push("server:kill") }),
    waitForHealth: async () => { throw expected; },
    installSignalHandlers: false,
  });

  await assert.rejects(launcher.start(), expected);
  assert.deepEqual(events, ["server:kill", "replset:stop"]);
});
