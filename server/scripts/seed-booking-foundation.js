const {
  normalizeServiceName,
  toServiceNameKey,
  toServiceSlug,
} = require("../utils/serviceNormalization");

const DEFAULT_SERVICES = [
  ["AC Service", "repair", "Air-conditioning inspection and service.", 90],
  ["Tyre Replacement", "tyre", "Tyre replacement and wheel safety check.", 60],
  [
    "Periodic Maintenance",
    "maintenance",
    "Scheduled inspection and preventive maintenance.",
    90,
  ],
  [
    "Oil and Filter Change",
    "maintenance",
    "Engine oil and filter replacement service.",
    60,
  ],
  [
    "Brake Inspection",
    "inspection",
    "Brake system inspection and condition assessment.",
    60,
  ],
  [
    "Battery and Electrical Check",
    "electrical",
    "Battery, charging, and electrical system check.",
    60,
  ],
  [
    "Wheel Alignment",
    "tyre",
    "Wheel alignment inspection and adjustment service.",
    90,
  ],
  [
    "Vehicle Cleaning",
    "cleaning",
    "Exterior and interior vehicle cleaning service.",
    60,
  ],
];

async function seedBookingFoundation(options = {}) {
  const Service = options.Service || require("../models/Service");
  const ensureDefaultWorkshopSchedule =
    options.ensureDefaultWorkshopSchedule ||
    require("../services/workshopScheduleService").ensureDefaultWorkshopSchedule;
  const currentDate = options.currentDate || (() => new Date());

  await ensureDefaultWorkshopSchedule();
  const insertedAt = currentDate();
  if (!(insertedAt instanceof Date) || Number.isNaN(insertedAt.getTime())) {
    throw new Error("Current time is unavailable");
  }

  for (const [name, category, description, durationMinutes] of DEFAULT_SERVICES) {
    const normalizedName = normalizeServiceName(name);
    const document = {
      name: normalizedName,
      slug: toServiceSlug(normalizedName),
      nameKey: toServiceNameKey(normalizedName),
      category,
      description,
      durationMinutes,
      isActive: true,
      bookingGuardVersion: 0,
      createdAt: insertedAt,
      updatedAt: insertedAt,
    };
    await Service.updateOne(
      { slug: document.slug },
      { $setOnInsert: document },
      { upsert: true, runValidators: true, timestamps: false },
    );
  }
}

async function runSeedCommand(options = {}) {
  const logger = options.logger || console;
  const runtime = options.runtime || process;
  let connected = false;
  let failed = false;

  try {
    const loadEnv =
      options.loadEnv || (() => require("dotenv").config({ quiet: true }));
    loadEnv();
    const readConfig = options.readConfig || require("../config/env").readConfig;
    const config = readConfig(options.env || process.env);
    const connectDB = options.connectDB || require("../config/db");
    await connectDB(config.mongoUri);
    connected = true;
    const seed = options.seedBookingFoundation || seedBookingFoundation;
    await seed();
  } catch {
    failed = true;
  } finally {
    if (connected) {
      const disconnectDB =
        options.disconnectDB || (() => require("mongoose").disconnect());
      try {
        await disconnectDB();
      } catch {
        failed = true;
      }
    }
  }

  if (failed) {
    logger.error("Booking foundation seed failed");
    runtime.exitCode = 1;
    return false;
  }

  logger.log("Booking foundation seed complete");
  return true;
}

if (require.main === module) {
  void runSeedCommand();
}

module.exports = { seedBookingFoundation, runSeedCommand };
