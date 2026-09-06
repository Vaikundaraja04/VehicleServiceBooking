const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const serverPackage = require("../../package.json");
const { seedDemoData, runSeedCommand } = require("../../scripts/seed-demo");
const User = require("../../models/User");
const Vehicle = require("../../models/Vehicle");
const { comparePassword } = require("../../services/passwordService");
const {
  connectTestDb,
  clearTestDb,
  disconnectTestDb,
} = require("../helpers/testDb");

test("demo seed module exports its seed and command functions", () => {
  const script = path.join(__dirname, "../../scripts/seed-demo.js");
  const child = spawnSync(
    process.execPath,
    [
      "-e",
      "const seed = require(process.argv[1]); process.stdout.write(String(typeof seed.seedDemoData === 'function' && typeof seed.runSeedCommand === 'function'))",
      script,
    ],
    { encoding: "utf8" },
  );

  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, "true");
});

test("package exposes the demo seed command", () => {
  assert.equal(serverPackage.scripts["seed:demo"], "node scripts/seed-demo.js");
});

test("demo seed command fails closed until explicitly enabled", async () => {
  const events = [];
  const runtime = { exitCode: 0 };

  const result = await runSeedCommand({
    env: { MONGO_URI: "mongodb://127.0.0.1:27017/demo" },
    async connectDB() { events.push("connect"); },
    async seedDemoData() { events.push("seed"); },
    logger: {
      log(message) { events.push(`log:${message}`); },
      error(message) { events.push(`error:${message}`); },
    },
    runtime,
  });

  assert.equal(result, false);
  assert.equal(runtime.exitCode, 1);
  assert.deepEqual(events, ["error:Demo seed failed"]);
});

test("demo seed command refuses production even when enabled", async () => {
  const events = [];
  const runtime = { exitCode: 0 };

  const result = await runSeedCommand({
    env: {
      ENABLE_DEMO_SEED: "true",
      NODE_ENV: "production",
      MONGO_URI: "mongodb://127.0.0.1:27017/demo",
    },
    async connectDB() { events.push("connect"); },
    async seedDemoData() { events.push("seed"); },
    logger: {
      log(message) { events.push(`log:${message}`); },
      error(message) { events.push(`error:${message}`); },
    },
    runtime,
  });

  assert.equal(result, false);
  assert.equal(runtime.exitCode, 1);
  assert.deepEqual(events, ["error:Demo seed failed"]);
});

test("demo seed command uses MONGO_URI and disconnects after a successful seed", async () => {
  const events = [];
  const runtime = { exitCode: 0 };
  const mongoUri = "mongodb://127.0.0.1:27017/vehicle_service_booking";

  const result = await runSeedCommand({
    env: { ENABLE_DEMO_SEED: "true", NODE_ENV: "development", MONGO_URI: mongoUri },
    loadEnv() { events.push("env"); },
    async connectDB(uri) { events.push(`connect:${uri}`); },
    async seedDemoData() { events.push("seed"); },
    async disconnectDB() { events.push("disconnect"); },
    logger: {
      log(message) { events.push(`log:${message}`); },
      error(message) { events.push(`error:${message}`); },
    },
    runtime,
  });

  assert.equal(result, true);
  assert.equal(runtime.exitCode, 0);
  assert.deepEqual(events, [
    "env",
    `connect:${mongoUri}`,
    "seed",
    "disconnect",
    "log:Demo seed complete",
  ]);
});

test("demo seed converges on two verified accounts and one active synthetic vehicle", async () => {
  const users = [];
  const vehicles = [];
  let userSequence = 0;

  const User = {
    findOne(filter) {
      const user = users.find((candidate) => candidate.email === filter.email);
      return {
        select() {
          return { lean: async () => (user ? { ...user } : null) };
        },
      };
    },
    async findOneAndUpdate(filter, update) {
      if (update.$set.email && update.$setOnInsert?.email) {
        throw new Error("MongoDB cannot update email in both $set and $setOnInsert");
      }
      let user = users.find((candidate) => candidate.email === filter.email);
      if (!user) {
        userSequence += 1;
        user = { _id: `user-${userSequence}`, ...update.$setOnInsert };
        users.push(user);
      }
      Object.assign(user, update.$set);
      return { ...user };
    },
  };
  const Vehicle = {
    findOne(filter) {
      const vehicle = vehicles.find(
        (candidate) => candidate.registrationNumber === filter.registrationNumber,
      );
      return { lean: async () => (vehicle ? { ...vehicle } : null) };
    },
    async findOneAndUpdate(filter, update) {
      let vehicle = vehicles.find(
        (candidate) => candidate.registrationNumber === filter.registrationNumber,
      );
      if (!vehicle) {
        vehicle = { ...update.$setOnInsert };
        vehicles.push(vehicle);
      }
      Object.assign(vehicle, update.$set);
      return { ...vehicle };
    },
  };

  const options = {
    User,
    Vehicle,
    async hashPassword(password) { return `hash:${password}`; },
    async comparePassword(password, passwordHash) {
      return passwordHash === `hash:${password}`;
    },
  };
  await seedDemoData(options);
  await seedDemoData(options);

  assert.deepEqual(users, [
    {
      _id: "user-1",
      username: "customer_demo",
      email: "customer.demo@example.com",
      mobile: "0000000000",
      address: "Synthetic demo account; not a real customer.",
      passwordHash: "hash:CustomerDemo#2026",
      role: "customer",
      isEmailVerified: true,
      isActive: true,
    },
    {
      _id: "user-2",
      username: "admin_demo",
      email: "admin.demo@example.com",
      passwordHash: "hash:AdminDemo#2026",
      role: "admin",
      isEmailVerified: true,
      isActive: true,
    },
  ]);
  assert.deepEqual(vehicles, [
    {
      registrationNumber: "DEMO2026",
      owner: "user-1",
      make: "Demo Motors",
      model: "Synthetic One",
      year: 2024,
      fuelType: "electric",
      status: "active",
      archivedAt: null,
      activeSlot: 1,
    },
  ]);
});

if (process.env.MONGO_URI_TEST) test.describe("live database: demo seed", () => {
  test.before(async () => {
    await connectTestDb();
    await User.init();
    await Vehicle.init();
  });
  test.beforeEach(clearTestDb);
  test.after(disconnectTestDb);

  test("creates stable credentials and exactly one compatible customer vehicle", async () => {
    await seedDemoData();
    await seedDemoData();

    const users = await User.find({}).select("+passwordHash").sort({ email: 1 }).lean();
    assert.equal(users.length, 2);
    assert.deepEqual(
      users.map(({ email, username, role, isEmailVerified, isActive }) => ({
        email,
        username,
        role,
        isEmailVerified,
        isActive,
      })),
      [
        {
          email: "admin.demo@example.com",
          username: "admin_demo",
          role: "admin",
          isEmailVerified: true,
          isActive: true,
        },
        {
          email: "customer.demo@example.com",
          username: "customer_demo",
          role: "customer",
          isEmailVerified: true,
          isActive: true,
        },
      ],
    );
    assert.equal(await comparePassword("AdminDemo#2026", users[0].passwordHash), true);
    assert.equal(await comparePassword("CustomerDemo#2026", users[1].passwordHash), true);

    const vehicles = await Vehicle.find({}).lean();
    assert.deepEqual(
      vehicles.map((vehicle) => ({
        owner: String(vehicle.owner),
        registrationNumber: vehicle.registrationNumber,
        make: vehicle.make,
        model: vehicle.model,
        year: vehicle.year,
        fuelType: vehicle.fuelType,
        status: vehicle.status,
        archivedAt: vehicle.archivedAt,
        activeSlot: vehicle.activeSlot,
      })),
      [
        {
          owner: String(users[1]._id),
          registrationNumber: "DEMO2026",
          make: "Demo Motors",
          model: "Synthetic One",
          year: 2024,
          fuelType: "electric",
          status: "active",
          archivedAt: null,
          activeSlot: 1,
        },
      ],
    );
  });

  test("leaves already-converged demo documents byte-for-byte unchanged", async () => {
    await seedDemoData();

    const firstUsers = await User.find({})
      .select("+passwordHash")
      .sort({ email: 1 })
      .lean();
    const firstVehicle = await Vehicle.findOne({ registrationNumber: "DEMO2026" }).lean();
    const firstState = {
      users: firstUsers.map(({ email, passwordHash, updatedAt }) => ({
        email,
        passwordHash,
        updatedAt,
      })),
      vehicleUpdatedAt: firstVehicle.updatedAt,
    };

    await seedDemoData();

    const secondUsers = await User.find({})
      .select("+passwordHash")
      .sort({ email: 1 })
      .lean();
    const secondVehicle = await Vehicle.findOne({ registrationNumber: "DEMO2026" }).lean();
    assert.deepEqual(
      {
        users: secondUsers.map(({ email, passwordHash, updatedAt }) => ({
          email,
          passwordHash,
          updatedAt,
        })),
        vehicleUpdatedAt: secondVehicle.updatedAt,
      },
      firstState,
    );
  });
});
