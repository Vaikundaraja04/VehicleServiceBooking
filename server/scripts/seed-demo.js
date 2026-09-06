const DEMO_ACCOUNTS = [
  {
    username: "customer_demo",
    email: "customer.demo@example.com",
    mobile: "0000000000",
    address: "Synthetic demo account; not a real customer.",
    password: "CustomerDemo#2026",
    role: "customer",
  },
  {
    username: "admin_demo",
    email: "admin.demo@example.com",
    password: "AdminDemo#2026",
    role: "admin",
  },
];

const DEMO_VEHICLE = {
  registrationNumber: "DEMO2026",
  make: "Demo Motors",
  model: "Synthetic One",
  year: 2024,
  fuelType: "electric",
  status: "active",
  archivedAt: null,
  activeSlot: 1,
};

function hasExactDemoAccount(user, account) {
  return (
    user &&
    user.username === account.username &&
    user.email === account.email &&
    user.role === account.role &&
    user.isEmailVerified === true &&
    user.isActive === true &&
    (account.mobile === undefined || user.mobile === account.mobile) &&
    (account.address === undefined || user.address === account.address)
  );
}

function hasExactDemoVehicle(vehicle, customerId) {
  return (
    vehicle &&
    String(vehicle.owner) === String(customerId) &&
    vehicle.make === DEMO_VEHICLE.make &&
    vehicle.model === DEMO_VEHICLE.model &&
    vehicle.year === DEMO_VEHICLE.year &&
    vehicle.fuelType === DEMO_VEHICLE.fuelType &&
    vehicle.status === DEMO_VEHICLE.status &&
    vehicle.archivedAt === DEMO_VEHICLE.archivedAt &&
    vehicle.activeSlot === DEMO_VEHICLE.activeSlot
  );
}

async function seedDemoData(options = {}) {
  const User = options.User || require("../models/User");
  const Vehicle = options.Vehicle || require("../models/Vehicle");
  const passwordService = require("../services/passwordService");
  const hashPassword = options.hashPassword || passwordService.hashPassword;
  const comparePassword = options.comparePassword || passwordService.comparePassword;
  const seededUsers = new Map();

  for (const account of DEMO_ACCOUNTS) {
    const existingUser = await User.findOne({ email: account.email })
      .select("+passwordHash")
      .lean();
    const passwordMatches = existingUser && await comparePassword(
      account.password,
      existingUser.passwordHash,
    );
    let user = existingUser;

    if (!hasExactDemoAccount(existingUser, account) || !passwordMatches) {
      user = await User.findOneAndUpdate(
        { email: account.email },
        {
          $set: {
            username: account.username,
            email: account.email,
            ...(account.mobile ? { mobile: account.mobile } : {}),
            ...(account.address ? { address: account.address } : {}),
            ...(!passwordMatches ? { passwordHash: await hashPassword(account.password) } : {}),
            role: account.role,
            isEmailVerified: true,
            isActive: true,
          },
        },
        {
          upsert: true,
          runValidators: true,
          returnDocument: "after",
          setDefaultsOnInsert: true,
        },
      );
    }
    seededUsers.set(account.role, user);
  }

  const customer = seededUsers.get("customer");
  const existingVehicle = await Vehicle.findOne({
    registrationNumber: DEMO_VEHICLE.registrationNumber,
  }).lean();
  if (!hasExactDemoVehicle(existingVehicle, customer._id)) {
    await Vehicle.findOneAndUpdate(
      { registrationNumber: DEMO_VEHICLE.registrationNumber },
      {
        $set: {
          owner: customer._id,
          make: DEMO_VEHICLE.make,
          model: DEMO_VEHICLE.model,
          year: DEMO_VEHICLE.year,
          fuelType: DEMO_VEHICLE.fuelType,
          status: DEMO_VEHICLE.status,
          archivedAt: DEMO_VEHICLE.archivedAt,
          activeSlot: DEMO_VEHICLE.activeSlot,
        },
        $setOnInsert: {
          registrationNumber: DEMO_VEHICLE.registrationNumber,
        },
      },
      {
        upsert: true,
        runValidators: true,
        returnDocument: "after",
        setDefaultsOnInsert: true,
      },
    );
  }
}

async function runSeedCommand(options = {}) {
  const logger = options.logger || console;
  const runtime = options.runtime || process;
  const env = options.env || process.env;
  let connected = false;
  let failed = false;

  try {
    const loadEnv = options.loadEnv || (() => require("dotenv").config({ quiet: true }));
    loadEnv();

    if (env.ENABLE_DEMO_SEED !== "true" || env.NODE_ENV === "production") {
      throw new Error("Demo seed is disabled");
    }
    if (!String(env.MONGO_URI || "").trim()) {
      throw new Error("MONGO_URI is required");
    }

    const connectDB = options.connectDB || require("../config/db");
    await connectDB(env.MONGO_URI);
    connected = true;

    const seed = options.seedDemoData || seedDemoData;
    await seed();

  } catch {
    failed = true;
  } finally {
    if (connected) {
      const disconnectDB = options.disconnectDB || (() => require("mongoose").disconnect());
      try {
        await disconnectDB();
      } catch {
        failed = true;
      }
    }
  }

  if (failed) {
    logger.error("Demo seed failed");
    runtime.exitCode = 1;
    return false;
  }

  logger.log("Demo seed complete");
  return true;
}

if (require.main === module) {
  void runSeedCommand();
}

module.exports = { seedDemoData, runSeedCommand };
