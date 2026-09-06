const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { EventEmitter } = require("node:events");

const { startServer } = require("./index");

const validConfig = {
  port: 5001,
  mongoUri: "mongodb://127.0.0.1:27017/vehicle_service_booking_test",
  clientUrl: "http://localhost:5173",
  trustedProxyIps: [],
};

test("startup initializes indexes and the schedule before listening", async () => {
  const events = [];
  const runtime = { exitCode: 0 };
  const server = new EventEmitter();
  server.on("error", () => {});

  const result = await startServer({
    loadEnv() {},
    env: {},
    readConfig() {
      events.push("config");
      return validConfig;
    },
    createApp(config) {
      assert.equal(config, validConfig);
      events.push("app");
      return {
        listen(port) {
          events.push(`listen:${port}`);
          queueMicrotask(() => {
            events.push("listening");
            server.emit("listening");
          });
          return server;
        },
      };
    },
    async connectDB(uri) {
      assert.equal(uri, validConfig.mongoUri);
      events.push("connect");
    },
    async initializeModels() {
      events.push("indexes");
    },
    async ensureDefaultWorkshopSchedule() {
      events.push("schedule");
    },
    logger: {
      error() {},
      log() { events.push("log"); },
    },
    runtime,
  });

  assert.equal(result, server);
  assert.deepEqual(events, [
    "config",
    "app",
    "connect",
    "indexes",
    "schedule",
    "listen:5001",
    "listening",
    "log",
  ]);
  assert.equal(runtime.exitCode, 0);
});

test("startup fails closed and disconnects when schedule initialization fails", async () => {
  const events = [];
  const errors = [];
  const runtime = { exitCode: 0 };

  const result = await startServer({
    loadEnv() {},
    readConfig: () => validConfig,
    createApp: () => ({
      listen() {
        events.push("listen");
        throw new Error("must not listen");
      },
    }),
    async connectDB() {
      events.push("connect");
    },
    async initializeModels() {
      events.push("indexes");
    },
    async ensureDefaultWorkshopSchedule() {
      events.push("schedule");
      throw new Error("default schedule unavailable");
    },
    async disconnectDB() {
      events.push("disconnect");
    },
    logger: {
      log() { events.push("log"); },
      error(message) { errors.push(message); },
    },
    runtime,
  });

  assert.equal(result, null);
  assert.deepEqual(events, ["connect", "indexes", "schedule", "disconnect"]);
  assert.deepEqual(errors, ["Server startup failed: default schedule unavailable"]);
  assert.equal(runtime.exitCode, 1);
});

test("server exits when MongoDB connection fails", async () => {
  const child = spawn(process.execPath, ["index.js"], {
    cwd: __dirname,
    env: {
      ...process.env,
      MONGO_URI: "invalid://database",
      PORT: "5001",
    },
  });

  let stderr = "";

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const result = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill();
    }, 2000);

    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /Server startup failed/);
});
