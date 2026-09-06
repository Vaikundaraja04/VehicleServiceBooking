const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const { initializeModels, startServer } = require("../index");
const AdminInvitation = require("../models/AdminInvitation");
const AuthToken = require("../models/AuthToken");
const Booking = require("../models/Booking");
const DeletedBooking = require("../models/DeletedBooking");
const MailDelivery = require("../models/MailDelivery");
const Service = require("../models/Service");
const User = require("../models/User");
const Vehicle = require("../models/Vehicle");
const WorkshopSchedule = require("../models/WorkshopSchedule");

const validConfig = {
  port: 5001,
  mongoUri: "mongodb://127.0.0.1:27017/vehicle_service_booking_test",
  clientUrl: "http://localhost:5173",
  trustedProxyIps: [],
};

test("startup awaits all persistence model indexes and the schedule before listening", async () => {
  const events = [];
  const server = new EventEmitter();
  server.name = "test-server";
  server.on("error", () => {});
  const app = {
    listen(port) {
      events.push(`listen:${port}`);
      queueMicrotask(() => {
        events.push("listening");
        server.emit("listening");
      });
      return server;
    },
  };
  const runtime = { exitCode: 0 };

  const result = await startServer({
    env: {},
    readConfig: () => {
      events.push("config");
      return validConfig;
    },
    createApp: (config) => {
      assert.equal(config, validConfig);
      events.push("app");
      return app;
    },
    connectDB: async (uri) => {
      assert.equal(uri, validConfig.mongoUri);
      events.push("connect");
    },
    disconnectDB: async () => {
      events.push("disconnect");
    },
    initializeModels: async () => {
      events.push("indexes");
    },
    ensureDefaultWorkshopSchedule: async () => {
      events.push("schedule");
    },
    logger: { error() {}, log() { events.push("log"); } },
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

test("startup fails closed when authentication index initialization fails", async () => {
  const events = [];
  const errors = [];
  const runtime = { exitCode: 0 };

  const result = await startServer({
    readConfig: () => validConfig,
    createApp: () => ({
      listen() {
        events.push("listen");
      },
    }),
    connectDB: async () => {
      events.push("connect");
    },
    disconnectDB: async () => {
      events.push("disconnect");
    },
    initializeModels: async () => {
      events.push("indexes");
      throw new Error("unique index unavailable");
    },
    logger: { log() {}, error(message) { errors.push(message); } },
    runtime,
  });

  assert.equal(result, null);
  assert.deepEqual(events, ["connect", "indexes", "disconnect"]);
  assert.deepEqual(errors, ["Server startup failed: unique index unavailable"]);
  assert.equal(runtime.exitCode, 1);
});

test("startup closes an acquired server and disconnects MongoDB after an asynchronous listen error", async () => {
  const events = [];
  const errors = [];
  const runtime = { exitCode: 0 };
  const server = new EventEmitter();
  server.on("error", () => {});
  server.close = (callback) => {
    events.push("close");
    callback();
  };

  const result = await startServer({
    readConfig: () => validConfig,
    createApp: () => ({
      listen() {
        events.push("listen");
        queueMicrotask(() => server.emit("error", new Error("address already in use")));
        return server;
      },
    }),
    connectDB: async () => {
      events.push("connect");
    },
    disconnectDB: async () => {
      events.push("disconnect");
    },
    initializeModels: async () => {
      events.push("indexes");
    },
    ensureDefaultWorkshopSchedule: async () => {
      events.push("schedule");
    },
    logger: { log() {}, error(message) { errors.push(message); } },
    runtime,
  });

  assert.equal(result, null);
  assert.deepEqual(events, [
    "connect",
    "indexes",
    "schedule",
    "listen",
    "close",
    "disconnect",
  ]);
  assert.deepEqual(errors, ["Server startup failed: address already in use"]);
  assert.equal(runtime.exitCode, 1);
});

test("startup reports missing configuration without importing or creating the app", async () => {
  const errors = [];
  let appCreations = 0;
  const runtime = { exitCode: 0 };

  const result = await startServer({
    env: {},
    createApp: () => {
      appCreations += 1;
      throw new Error("app must not be created");
    },
    logger: { log() {}, error(message) { errors.push(message); } },
    runtime,
  });

  assert.equal(result, null);
  assert.equal(appCreations, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^Server startup failed: Missing environment variables:/);
  assert.equal(errors[0].includes("\n"), false);
  assert.equal(runtime.exitCode, 1);
});

test("startup reports app creation failures through the same controlled boundary", async () => {
  const errors = [];
  const runtime = { exitCode: 0 };

  const result = await startServer({
    readConfig: () => validConfig,
    createApp: () => {
      throw new Error("app composition failed");
    },
    logger: { log() {}, error(message) { errors.push(message); } },
    runtime,
  });

  assert.equal(result, null);
  assert.deepEqual(errors, ["Server startup failed: app composition failed"]);
  assert.equal(runtime.exitCode, 1);
});

test("startup initializes every persistence model index", async () => {
  const initialized = [];
  const models = [
    User,
    AuthToken,
    AdminInvitation,
    Vehicle,
    Service,
    WorkshopSchedule,
    Booking,
    DeletedBooking,
    MailDelivery,
  ];
  const originalInitializers = models.map((model) => model.init);
  models.forEach((model) => {
    model.init = async () => {
      initialized.push(model.modelName);
    };
  });

  try {
    await initializeModels();
  } finally {
    models.forEach((model, index) => {
      model.init = originalInitializers[index];
    });
  }

  assert.deepEqual(initialized, [
    "User",
    "AuthToken",
    "AdminInvitation",
    "Vehicle",
    "Service",
    "WorkshopSchedule",
    "Booking",
    "DeletedBooking",
    "MailDelivery",
  ]);
});
