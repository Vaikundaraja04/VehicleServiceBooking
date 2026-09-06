const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const Booking = require("../../models/Booking");
const User = require("../../models/User");
const Vehicle = require("../../models/Vehicle");
const WorkshopSchedule = require("../../models/WorkshopSchedule");
const {
  createDashboardService,
  getAdminDashboard,
  getCustomerDashboard,
} = require("../../services/dashboardService");
const AppError = require("../../utils/AppError");
const { buildReservedSlotKeys } = require("../../utils/bookingReservation");
const { resolveOpeningInterval } = require("../../services/availabilityService");
const {
  connectTestDb,
  clearTestDb,
  disconnectTestDb,
} = require("../helpers/testDb");

const CUSTOMER_ID = new mongoose.Types.ObjectId("68b54f1bfc13ae11b3000001");
const NOW = new Date("2026-08-30T08:00:00.000Z");
const EMPTY_SCHEDULE = {
  key: "default",
  timeZone: "Asia/Kolkata",
  bayCount: 2,
  weeklyHours: Array.from({ length: 7 }, (_value, index) => ({
    weekday: index + 1,
    isClosed: true,
  })),
  dateOverrides: [],
};
const ADMIN_WORKLOAD_SCHEDULE = {
  key: "default",
  timeZone: "Asia/Kolkata",
  bayCount: 2,
  weeklyHours: [
    { weekday: 1, isClosed: true },
    { weekday: 2, isClosed: false, openMinute: 480, closeMinute: 840 },
    { weekday: 3, isClosed: false, openMinute: 540, closeMinute: 1020 },
    { weekday: 4, isClosed: true },
    { weekday: 5, isClosed: true },
    { weekday: 6, isClosed: true },
    { weekday: 7, isClosed: false, openMinute: 540, closeMinute: 1020 },
  ],
  dateOverrides: [
    {
      date: "2026-08-31",
      isClosed: false,
      openMinute: 600,
      closeMinute: 720,
    },
    { date: "2026-09-01", isClosed: true },
  ],
};

function injectedHarness({
  activeVehicles = 0,
  aggregation = [],
  schedule = EMPTY_SCHEDULE,
  openingResolver = () => null,
} = {}) {
  const capture = {
    aggregate: [],
    countDocuments: [],
    scheduleFindOne: [],
    scheduleLean: 0,
    openingIntervals: [],
    writes: [],
  };
  const write = (model, method) => () => {
    capture.writes.push(`${model}.${method}`);
    throw new Error("dashboard service attempted a write");
  };
  const Booking = {
    aggregate(pipeline) {
      capture.aggregate.push(pipeline);
      return Promise.resolve(aggregation);
    },
    create: write("Booking", "create"),
    insertMany: write("Booking", "insertMany"),
    updateOne: write("Booking", "updateOne"),
    updateMany: write("Booking", "updateMany"),
    findOneAndUpdate: write("Booking", "findOneAndUpdate"),
    deleteOne: write("Booking", "deleteOne"),
    deleteMany: write("Booking", "deleteMany"),
  };
  const Vehicle = {
    countDocuments(filter) {
      capture.countDocuments.push(filter);
      return Promise.resolve(activeVehicles);
    },
    create: write("Vehicle", "create"),
    insertMany: write("Vehicle", "insertMany"),
    updateOne: write("Vehicle", "updateOne"),
    updateMany: write("Vehicle", "updateMany"),
    findOneAndUpdate: write("Vehicle", "findOneAndUpdate"),
    deleteOne: write("Vehicle", "deleteOne"),
    deleteMany: write("Vehicle", "deleteMany"),
  };
  const WorkshopSchedule = {
    findOne(filter) {
      capture.scheduleFindOne.push(filter);
      return {
        lean() {
          capture.scheduleLean += 1;
          return Promise.resolve(schedule);
        },
      };
    },
    create: write("WorkshopSchedule", "create"),
    insertMany: write("WorkshopSchedule", "insertMany"),
    updateOne: write("WorkshopSchedule", "updateOne"),
    updateMany: write("WorkshopSchedule", "updateMany"),
    findOneAndUpdate: write("WorkshopSchedule", "findOneAndUpdate"),
    deleteOne: write("WorkshopSchedule", "deleteOne"),
    deleteMany: write("WorkshopSchedule", "deleteMany"),
  };
  const User = {
    collection: { name: "users" },
    create: write("User", "create"),
    insertMany: write("User", "insertMany"),
    updateOne: write("User", "updateOne"),
    updateMany: write("User", "updateMany"),
    findOneAndUpdate: write("User", "findOneAndUpdate"),
    deleteOne: write("User", "deleteOne"),
    deleteMany: write("User", "deleteMany"),
  };
  const service = createDashboardService({
    Booking,
    Vehicle,
    WorkshopSchedule,
    User,
    resolveOpeningInterval(input) {
      capture.openingIntervals.push(input);
      return openingResolver(input);
    },
    isValidObjectId: mongoose.isValidObjectId,
  });
  return { capture, service };
}

test("customer dashboard rejects invalid now before any model read", async () => {
  for (const now of [undefined, "2026-08-30", new Date(Number.NaN)]) {
    const { capture, service } = injectedHarness();

    await assert.rejects(service.getCustomerDashboard({ customerId: CUSTOMER_ID, now }));

    assert.deepEqual(capture.countDocuments, []);
    assert.deepEqual(capture.aggregate, []);
    assert.deepEqual(capture.scheduleFindOne, []);
    assert.equal(capture.scheduleLean, 0);
    assert.deepEqual(capture.writes, []);
  }
});

test("customer dashboard performs the exact active-vehicle count and one customer-first facet", async () => {
  const { capture, service } = injectedHarness({
    activeVehicles: 0,
    aggregation: [{
      upcomingBookings: [],
      completedBookings: [],
      nextBooking: [],
      recentActivity: [],
    }],
  });

  const dashboard = await service.getCustomerDashboard({
    customerId: CUSTOMER_ID,
    now: NOW,
  });

  assert.deepEqual(capture.countDocuments, [{
    owner: CUSTOMER_ID,
    status: "active",
  }]);
  assert.equal(capture.aggregate.length, 1);
  const pipeline = capture.aggregate[0];
  assert.deepEqual(pipeline[0], { $match: { customer: CUSTOMER_ID } });
  assert.equal(pipeline.some((stage) => Object.hasOwn(stage, "$unwind")), false);
  assert.equal(Object.hasOwn(pipeline[1], "$facet"), true);

  const facets = pipeline[1].$facet;
  assert.deepEqual(Object.keys(facets).sort(), [
    "completedBookings",
    "nextBooking",
    "recentActivity",
    "upcomingBookings",
  ]);
  const upcomingFilter = {
    $or: [
      { status: { $in: ["requested", "confirmed"] }, endsAt: { $gte: NOW } },
      { status: "in_service" },
    ],
  };
  assert.deepEqual(facets.upcomingBookings, [
    { $match: upcomingFilter },
    { $count: "count" },
  ]);
  assert.deepEqual(facets.completedBookings, [
    { $match: { status: "completed" } },
    { $count: "count" },
  ]);
  assert.deepEqual(facets.nextBooking.slice(0, 3), [
    { $match: upcomingFilter },
    { $sort: { startsAt: 1, _id: 1 } },
    { $limit: 1 },
  ]);
  assert.deepEqual(facets.recentActivity.slice(0, 3), [
    { $unwind: { path: "$statusHistory", includeArrayIndex: "historyIndex" } },
    { $sort: { "statusHistory.changedAt": -1, _id: 1, historyIndex: -1 } },
    { $limit: 5 },
  ]);
  assert.deepEqual(dashboard.summary, {
    activeVehicles: 0,
    upcomingBookings: 0,
    completedBookings: 0,
  });
  assert.deepEqual(dashboard.action, {
    kind: "add_vehicle",
    href: "/vehicles",
    label: "Add your first vehicle",
  });
  assert.equal(dashboard.nextBooking, null);
  assert.deepEqual(dashboard.recentActivity, []);
  assert.deepEqual(capture.writes, []);
});

test("dashboard service publishes the default administrator production method", () => {
  assert.equal(typeof getAdminDashboard, "function");
});

test("administrator dashboard rejects invalid now before any model read", async () => {
  for (const now of [undefined, "2026-08-30", new Date(Number.NaN)]) {
    const { capture, service } = injectedHarness();

    await assert.rejects(
      service.getAdminDashboard({ now }),
      {
        name: "TypeError",
        message: "Dashboard now must be a valid Date",
      },
    );

    assert.deepEqual(capture.countDocuments, []);
    assert.deepEqual(capture.aggregate, []);
    assert.deepEqual(capture.scheduleFindOne, []);
    assert.equal(capture.scheduleLean, 0);
    assert.deepEqual(capture.writes, []);
  }
});

test("administrator dashboard reads the singleton schedule and one bounded facet", async () => {
  const { capture, service } = injectedHarness({
    aggregation: [{
      totalBookings: [],
      byStatus: [],
      todayAppointments: [],
      workload: [],
      attention: [],
    }],
  });

  const dashboard = await service.getAdminDashboard({ now: NOW });

  assert.deepEqual(capture.scheduleFindOne, [{ key: "default" }]);
  assert.equal(capture.scheduleLean, 1);
  assert.equal(capture.aggregate.length, 1);
  assert.deepEqual(capture.countDocuments, []);
  assert.deepEqual(capture.writes, []);

  const [{ $facet: facets }] = capture.aggregate[0];
  assert.deepEqual(Object.keys(facets).sort(), [
    "attention",
    "byStatus",
    "todayAppointments",
    "totalBookings",
    "workload",
  ]);
  assert.deepEqual(facets.totalBookings, [{ $count: "count" }]);
  assert.deepEqual(facets.byStatus, [
    { $group: { _id: "$status", count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);

  const liveStatusFilter = {
    status: { $in: ["requested", "confirmed", "in_service"] },
    reservedSlotKeys: { $exists: true },
  };
  const todayStart = new Date("2026-08-29T18:30:00.000Z");
  const tomorrowStart = new Date("2026-08-30T18:30:00.000Z");
  const afterSeventhStart = new Date("2026-09-05T18:30:00.000Z");
  assert.deepEqual(facets.todayAppointments, [
    {
      $match: {
        ...liveStatusFilter,
        startsAt: { $gte: todayStart, $lt: tomorrowStart },
      },
    },
    { $count: "count" },
  ]);
  assert.deepEqual(facets.workload[0], {
    $match: {
      ...liveStatusFilter,
      startsAt: { $gte: todayStart, $lt: afterSeventhStart },
    },
  });
  assert.equal(dashboard.role, "admin");
  assert.deepEqual(dashboard.generatedAt, NOW);
});

test("administrator dashboard rejects a missing schedule with the controlled 503", async () => {
  const { capture, service } = injectedHarness({ schedule: null });

  await assert.rejects(
    service.getAdminDashboard({ now: NOW }),
    (error) => error instanceof AppError
      && error.statusCode === 503
      && error.message === "Workshop schedule is unavailable",
  );

  assert.deepEqual(capture.scheduleFindOne, [{ key: "default" }]);
  assert.equal(capture.scheduleLean, 1);
  assert.deepEqual(capture.aggregate, []);
  assert.deepEqual(capture.countDocuments, []);
  assert.deepEqual(capture.writes, []);
});

test("administrator workload resolves seven schedule-aware local dates and live duration totals", async () => {
  const schedule = ADMIN_WORKLOAD_SCHEDULE;
  const { capture, service } = injectedHarness({
    schedule,
    openingResolver: resolveOpeningInterval,
    aggregation: [{
      totalBookings: [{ count: 12 }],
      byStatus: [],
      todayAppointments: [{ count: 2 }],
      workload: [
        { date: "2026-08-30", appointmentCount: 2, reservedMinutes: 120 },
        { date: "2026-08-31", appointmentCount: 3, reservedMinutes: 270 },
        { date: "2026-09-01", appointmentCount: 1, reservedMinutes: 90 },
        { date: "2026-09-02", appointmentCount: 1, reservedMinutes: 90 },
      ],
      attention: [],
    }],
  });

  const dashboard = await service.getAdminDashboard({ now: NOW });

  assert.equal(dashboard.summary.todayAppointments, 2);
  assert.deepEqual(dashboard.workload, [
    {
      date: "2026-08-30",
      appointmentCount: 2,
      reservedMinutes: 120,
      availableBayMinutes: 960,
      utilizationPercent: 12.5,
    },
    {
      date: "2026-08-31",
      appointmentCount: 3,
      reservedMinutes: 270,
      availableBayMinutes: 240,
      utilizationPercent: 100,
    },
    {
      date: "2026-09-01",
      appointmentCount: 1,
      reservedMinutes: 90,
      availableBayMinutes: 0,
      utilizationPercent: 0,
    },
    {
      date: "2026-09-02",
      appointmentCount: 1,
      reservedMinutes: 90,
      availableBayMinutes: 960,
      utilizationPercent: 9.4,
    },
    {
      date: "2026-09-03",
      appointmentCount: 0,
      reservedMinutes: 0,
      availableBayMinutes: 0,
      utilizationPercent: 0,
    },
    {
      date: "2026-09-04",
      appointmentCount: 0,
      reservedMinutes: 0,
      availableBayMinutes: 0,
      utilizationPercent: 0,
    },
    {
      date: "2026-09-05",
      appointmentCount: 0,
      reservedMinutes: 0,
      availableBayMinutes: 0,
      utilizationPercent: 0,
    },
  ]);
  assert.deepEqual(
    capture.openingIntervals.map(({ schedule: usedSchedule, localDate }) => ({
      sameSchedule: usedSchedule === schedule,
      localDate,
    })),
    [
      { sameSchedule: true, localDate: "2026-08-30" },
      { sameSchedule: true, localDate: "2026-08-31" },
      { sameSchedule: true, localDate: "2026-09-01" },
      { sameSchedule: true, localDate: "2026-09-02" },
      { sameSchedule: true, localDate: "2026-09-03" },
      { sameSchedule: true, localDate: "2026-09-04" },
      { sameSchedule: true, localDate: "2026-09-05" },
    ],
  );

  const [{ $facet: facets }] = capture.aggregate[0];
  assert.deepEqual(facets.workload.slice(1), [
    {
      $group: {
        _id: "$localDate",
        appointmentCount: { $sum: 1 },
        reservedMinutes: { $sum: "$serviceSnapshot.durationMinutes" },
      },
    },
    {
      $project: {
        _id: 0,
        date: "$_id",
        appointmentCount: 1,
        reservedMinutes: 1,
      },
    },
    { $sort: { date: 1 } },
  ]);
  assert.equal(
    facets.workload.some((stage) => Object.hasOwn(stage, "$unwind")),
    false,
  );
  assert.deepEqual(capture.writes, []);
});

test("administrator summary maps every grouped status and zero-fills missing statuses", async () => {
  const { service } = injectedHarness({
    aggregation: [{
      totalBookings: [{ count: 19 }],
      byStatus: [
        { _id: "requested", count: 2 },
        { _id: "confirmed", count: 3 },
        { _id: "in_service", count: 4 },
        { _id: "completed", count: 5 },
        { _id: "cancelled", count: 2 },
        { _id: "rejected", count: 3 },
      ],
      todayAppointments: [{ count: 4 }],
      workload: [],
      attention: [],
    }],
  });

  const dashboard = await service.getAdminDashboard({ now: NOW });

  assert.deepEqual(dashboard.summary, {
    totalBookings: 19,
    todayAppointments: 4,
    byStatus: {
      requested: 2,
      confirmed: 3,
      in_service: 4,
      completed: 5,
      cancelled: 2,
      rejected: 3,
      no_show: 0,
    },
  });
});

test("administrator attention applies exact inclusive rules, ordering, limit, and safe identity", async () => {
  const customerId = new mongoose.Types.ObjectId("68b54f1bfc13ae11b3000100");
  const sameStart = new Date("2026-08-30T07:00:00.000Z");
  const attentionEntry = ({ _id, kind, startsAt, status, suffix }) => ({
    _id: new mongoose.Types.ObjectId(_id),
    kind,
    startsAt,
    status,
    customer: {
      _id: customerId,
      username: `attention_customer_${suffix}`,
      email: `attention_${suffix}@example.com`,
      passwordHash: "must-not-leak",
      role: "customer",
    },
    vehicleSnapshot: {
      registrationNumber: `TN01ATTN${suffix}`,
      make: "must-not-leak",
    },
    serviceSnapshot: {
      name: `Attention service ${suffix}`,
      durationMinutes: 90,
    },
    actor: { username: "must-not-leak" },
    bayNumber: 5,
    reservedSlotKeys: ["must-not-leak"],
  });
  const attention = [
    attentionEntry({
      _id: "68b54f1bfc13ae11b3000101",
      kind: "overdue_confirmed",
      startsAt: sameStart,
      status: "confirmed",
      suffix: "01",
    }),
    attentionEntry({
      _id: "68b54f1bfc13ae11b3000102",
      kind: "overdue_confirmed",
      startsAt: sameStart,
      status: "confirmed",
      suffix: "02",
    }),
    attentionEntry({
      _id: "68b54f1bfc13ae11b3000103",
      kind: "requested_soon",
      startsAt: NOW,
      status: "requested",
      suffix: "03",
    }),
    attentionEntry({
      _id: "68b54f1bfc13ae11b3000104",
      kind: "requested_soon",
      startsAt: new Date("2026-08-31T08:00:00.000Z"),
      status: "requested",
      suffix: "04",
    }),
    attentionEntry({
      _id: "68b54f1bfc13ae11b3000105",
      kind: "in_service",
      startsAt: new Date("2026-09-03T08:00:00.000Z"),
      status: "in_service",
      suffix: "05",
    }),
    attentionEntry({
      _id: "68b54f1bfc13ae11b3000106",
      kind: "in_service",
      startsAt: new Date("2026-09-04T08:00:00.000Z"),
      status: "in_service",
      suffix: "06",
    }),
  ];
  const { capture, service } = injectedHarness({
    aggregation: [{
      totalBookings: [{ count: 6 }],
      byStatus: [],
      todayAppointments: [],
      workload: [],
      attention,
    }],
  });

  const dashboard = await service.getAdminDashboard({ now: NOW });

  assert.deepEqual(
    dashboard.attention,
    attention.slice(0, 5).map((entry) => ({
      kind: entry.kind,
      bookingId: entry._id.toString(),
      startsAt: entry.startsAt,
      status: entry.status,
      customer: {
        id: customerId.toString(),
        username: entry.customer.username,
        email: entry.customer.email,
      },
      vehicleRegistrationNumber: entry.vehicleSnapshot.registrationNumber,
      serviceName: entry.serviceSnapshot.name,
      href: `/admin/bookings/${entry._id}`,
    })),
  );
  assertNoForbiddenKeys(dashboard.attention, new Set([
    "_id",
    "passwordHash",
    "role",
    "actor",
    "bayNumber",
    "reservedSlotKeys",
    "vehicleSnapshot",
    "serviceSnapshot",
    "durationMinutes",
    "make",
  ]));

  const [{ $facet: facets }] = capture.aggregate[0];
  assert.deepEqual(facets.attention, [
    {
      $match: {
        $or: [
          { status: "confirmed", startsAt: { $lte: NOW } },
          {
            status: "requested",
            startsAt: {
              $gte: NOW,
              $lte: new Date("2026-08-31T08:00:00.000Z"),
            },
          },
          { status: "in_service" },
        ],
      },
    },
    {
      $addFields: {
        priority: {
          $switch: {
            branches: [
              { case: { $eq: ["$status", "confirmed"] }, then: 1 },
              { case: { $eq: ["$status", "requested"] }, then: 2 },
              { case: { $eq: ["$status", "in_service"] }, then: 3 },
            ],
            default: 4,
          },
        },
        kind: {
          $switch: {
            branches: [
              {
                case: { $eq: ["$status", "confirmed"] },
                then: "overdue_confirmed",
              },
              {
                case: { $eq: ["$status", "requested"] },
                then: "requested_soon",
              },
              {
                case: { $eq: ["$status", "in_service"] },
                then: "in_service",
              },
            ],
            default: null,
          },
        },
      },
    },
    { $sort: { priority: 1, startsAt: 1, _id: 1 } },
    { $limit: 5 },
    {
      $lookup: {
        from: "users",
        localField: "customer",
        foreignField: "_id",
        as: "customer",
      },
    },
    { $unwind: "$customer" },
    {
      $project: {
        _id: 1,
        kind: 1,
        startsAt: 1,
        status: 1,
        "customer._id": 1,
        "customer.username": 1,
        "customer.email": 1,
        "vehicleSnapshot.registrationNumber": 1,
        "serviceSnapshot.name": 1,
      },
    },
  ]);
});

const ADMIN_ID = new mongoose.Types.ObjectId("68b54f1bfc13ae11b3000002");
const FOREIGN_CUSTOMER_ID = new mongoose.Types.ObjectId("68b54f1bfc13ae11b3000003");
const ARCHIVED_CUSTOMER_ID = new mongoose.Types.ObjectId("68b54f1bfc13ae11b3000004");
const PRIMARY_VEHICLE_ID = new mongoose.Types.ObjectId("68b54f1bfc13ae11b3000005");
const SERVICE_ID = new mongoose.Types.ObjectId("68b54f1bfc13ae11b3000006");
const NEXT_BOOKING_ID = new mongoose.Types.ObjectId("68b54f1bfc13ae11b3000010");
const TIED_BOOKING_ID = new mongoose.Types.ObjectId("68b54f1bfc13ae11b3000011");
const COMPLETED_BOOKING_ID = new mongoose.Types.ObjectId("68b54f1bfc13ae11b3000020");
const IN_SERVICE_BOOKING_ID = new mongoose.Types.ObjectId("68b54f1bfc13ae11b3000030");
const TIED_IN_SERVICE_BOOKING_ID = new mongoose.Types.ObjectId("68b54f1bfc13ae11b3000031");
const EXPIRED_BOOKING_ID = new mongoose.Types.ObjectId("68b54f1bfc13ae11b3000040");
const FOREIGN_BOOKING_ID = new mongoose.Types.ObjectId("68b54f1bfc13ae11b3000007");

const dashboardAdmin = {
  _id: ADMIN_ID,
  username: "dashboard_admin",
  role: "admin",
};

function userFixture({ _id, username, role = "customer" }) {
  return {
    _id,
    username,
    email: `${username}@example.com`,
    mobile: role === "customer" ? "9876543210" : undefined,
    address: role === "customer" ? "1 Dashboard Road" : undefined,
    passwordHash: "dashboard-test-password-hash",
    role,
    isEmailVerified: true,
    isActive: true,
  };
}

function vehicleFixture({
  _id = new mongoose.Types.ObjectId(),
  owner,
  registrationNumber,
  activeSlot,
  status = "active",
}) {
  return {
    _id,
    owner,
    registrationNumber,
    make: "Current vehicle make",
    model: "Current vehicle model",
    year: 2024,
    fuelType: "electric",
    status,
    activeSlot: status === "active" ? activeSlot : null,
    archivedAt: status === "archived" ? new Date("2026-08-01T00:00:00.000Z") : null,
  };
}

function requestedBookingFixture({
  _id,
  customer,
  vehicle = PRIMARY_VEHICLE_ID,
  startsAt,
  bayNumber,
  changedAt,
  registrationNumber = "TN01SNAP01",
}) {
  const endsAt = new Date(startsAt.getTime() + 30 * 60 * 1000);
  return {
    _id,
    customer: customer._id,
    vehicle,
    vehicleSnapshot: {
      registrationNumber,
      make: "Booking snapshot make",
      model: "Booking snapshot model",
      year: 2022,
      fuelType: "petrol",
    },
    service: SERVICE_ID,
    serviceSnapshot: {
      name: "Booking snapshot service",
      slug: "booking-snapshot-service",
      category: "maintenance",
      durationMinutes: 30,
    },
    startsAt,
    endsAt,
    localDate: startsAt.toISOString().slice(0, 10),
    timeZone: "Asia/Kolkata",
    bayNumber,
    reservedSlotKeys: buildReservedSlotKeys({ startsAt, durationMinutes: 30, bayNumber }),
    status: "requested",
    statusHistory: [{
      fromStatus: null,
      toStatus: "requested",
      changedAt,
      actor: {
        userId: customer._id,
        username: customer.username,
        role: "customer",
      },
      reason: null,
    }],
  };
}

async function moveBooking(bookingId, statuses) {
  for (const { toStatus, now } of statuses) {
    const current = await Booking.findById(bookingId).lean();
    await Booking.findOneAndUpdate(
      { _id: bookingId, status: current.status },
      {
        $set: { status: toStatus },
        $push: {
          statusHistory: {
            fromStatus: current.status,
            toStatus,
            changedAt: now,
            actor: {
              userId: dashboardAdmin._id,
              username: dashboardAdmin.username,
              role: dashboardAdmin.role,
            },
            reason: null,
          },
        },
      },
      { returnDocument: "after", runValidators: true },
    );
  }
}

function plainSnapshot(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertNoForbiddenKeys(value, forbiddenKeys) {
  if (Array.isArray(value)) {
    value.forEach((entry) => assertNoForbiddenKeys(entry, forbiddenKeys));
    return;
  }
  if (value && typeof value === "object" && !(value instanceof Date)) {
    for (const [key, nested] of Object.entries(value)) {
      assert.equal(forbiddenKeys.has(key), false, `forbidden key: ${key}`);
      assertNoForbiddenKeys(nested, forbiddenKeys);
    }
  }
}

if (process.env.MONGO_URI_TEST) test.describe("live database: customer dashboard aggregation", () => {
  let primaryCustomer;
  let foreignCustomer;

  test.before(async () => {
    await connectTestDb();
    await Promise.all([Booking.init(), User.init(), Vehicle.init()]);
  });
  test.beforeEach(async () => {
    await clearTestDb();
    [primaryCustomer, foreignCustomer] = await User.create([
      userFixture({ _id: CUSTOMER_ID, username: "dashboard_customer" }),
      userFixture({ _id: FOREIGN_CUSTOMER_ID, username: "foreign_customer" }),
    ]);
    await User.create(userFixture({
      _id: ARCHIVED_CUSTOMER_ID,
      username: "archived_customer",
    }));
    await User.create(userFixture({
      _id: ADMIN_ID,
      username: dashboardAdmin.username,
      role: "admin",
    }));

    await Vehicle.create([
      vehicleFixture({
        _id: PRIMARY_VEHICLE_ID,
        owner: CUSTOMER_ID,
        registrationNumber: "TN01LIVE01",
        activeSlot: 1,
      }),
      vehicleFixture({
        owner: CUSTOMER_ID,
        registrationNumber: "TN01LIVE02",
        activeSlot: 2,
      }),
      vehicleFixture({
        owner: CUSTOMER_ID,
        registrationNumber: "TN01LIVE03",
        status: "archived",
      }),
      vehicleFixture({
        owner: FOREIGN_CUSTOMER_ID,
        registrationNumber: "TN01LIVE04",
        activeSlot: 1,
      }),
      vehicleFixture({
        owner: ARCHIVED_CUSTOMER_ID,
        registrationNumber: "TN01LIVE05",
        status: "archived",
      }),
    ]);

    await Booking.create(requestedBookingFixture({
      _id: NEXT_BOOKING_ID,
      customer: primaryCustomer,
      startsAt: new Date("2026-08-31T04:30:00.000Z"),
      bayNumber: 1,
      changedAt: new Date("2026-08-30T07:45:00.000Z"),
    }));
    await Booking.create(requestedBookingFixture({
      _id: TIED_BOOKING_ID,
      customer: primaryCustomer,
      startsAt: new Date("2026-08-31T04:30:00.000Z"),
      bayNumber: 2,
      changedAt: new Date("2026-08-29T04:00:00.000Z"),
      registrationNumber: "TN01SNAP02",
    }));
    await moveBooking(TIED_BOOKING_ID, [{
      toStatus: "confirmed",
      now: new Date("2026-08-30T07:50:00.000Z"),
    }]);

    await Booking.create(requestedBookingFixture({
      _id: COMPLETED_BOOKING_ID,
      customer: primaryCustomer,
      startsAt: new Date("2026-08-29T04:30:00.000Z"),
      bayNumber: 3,
      changedAt: new Date("2026-08-28T06:00:00.000Z"),
      registrationNumber: "TN01SNAP03",
    }));
    await moveBooking(COMPLETED_BOOKING_ID, [
      { toStatus: "confirmed", now: new Date("2026-08-28T06:30:00.000Z") },
      { toStatus: "in_service", now: new Date("2026-08-30T07:55:00.000Z") },
      { toStatus: "completed", now: new Date("2026-08-30T07:55:00.000Z") },
    ]);

    await Booking.create(requestedBookingFixture({
      _id: IN_SERVICE_BOOKING_ID,
      customer: primaryCustomer,
      startsAt: new Date("2026-08-29T05:30:00.000Z"),
      bayNumber: 4,
      changedAt: new Date("2026-08-28T07:00:00.000Z"),
      registrationNumber: "TN01SNAP04",
    }));
    await moveBooking(IN_SERVICE_BOOKING_ID, [
      { toStatus: "confirmed", now: new Date("2026-08-28T07:30:00.000Z") },
      { toStatus: "in_service", now: new Date("2026-08-30T07:55:00.000Z") },
    ]);
    await Booking.create(requestedBookingFixture({
      _id: TIED_IN_SERVICE_BOOKING_ID,
      customer: primaryCustomer,
      startsAt: new Date("2026-08-29T05:30:00.000Z"),
      bayNumber: 5,
      changedAt: new Date("2026-08-28T08:00:00.000Z"),
      registrationNumber: "TN01SNAP06",
    }));
    await moveBooking(TIED_IN_SERVICE_BOOKING_ID, [
      { toStatus: "confirmed", now: new Date("2026-08-28T08:30:00.000Z") },
      { toStatus: "in_service", now: new Date("2026-08-30T07:40:00.000Z") },
    ]);

    await Booking.create(requestedBookingFixture({
      _id: EXPIRED_BOOKING_ID,
      customer: primaryCustomer,
      startsAt: new Date("2026-08-29T06:30:00.000Z"),
      bayNumber: 5,
      changedAt: new Date("2026-08-29T06:00:00.000Z"),
      registrationNumber: "TN01SNAP05",
    }));
    await Booking.create(requestedBookingFixture({
      _id: FOREIGN_BOOKING_ID,
      customer: foreignCustomer,
      vehicle: new mongoose.Types.ObjectId("68b54f1bfc13ae11b3000008"),
      startsAt: new Date("2026-08-29T07:30:00.000Z"),
      bayNumber: 1,
      changedAt: new Date("2026-08-30T08:00:00.000Z"),
      registrationNumber: "TN01FOREIGN",
    }));
  });
  test.after(disconnectTestDb);

  test("isolates ownership, applies upcoming semantics, and maps deterministic safe snapshots", async () => {
    const before = plainSnapshot({
      bookings: await Booking.find().select("+reservedSlotKeys").sort({ _id: 1 }).lean(),
      vehicles: await Vehicle.find().select("+bookingGuardVersion").sort({ _id: 1 }).lean(),
    });

    const dashboard = await getCustomerDashboard({ customerId: CUSTOMER_ID, now: NOW });

    assert.deepEqual(dashboard.summary, {
      activeVehicles: 2,
      upcomingBookings: 4,
      completedBookings: 1,
    });
    assert.deepEqual(dashboard.nextBooking, {
      id: IN_SERVICE_BOOKING_ID.toString(),
      vehicle: {
        id: PRIMARY_VEHICLE_ID.toString(),
        registrationNumber: "TN01SNAP04",
        make: "Booking snapshot make",
        model: "Booking snapshot model",
        year: 2022,
        fuelType: "petrol",
      },
      service: {
        name: "Booking snapshot service",
        slug: "booking-snapshot-service",
        category: "maintenance",
        durationMinutes: 30,
      },
      startsAt: new Date("2026-08-29T05:30:00.000Z"),
      endsAt: new Date("2026-08-29T06:00:00.000Z"),
      localDate: "2026-08-29",
      timeZone: "Asia/Kolkata",
      status: "in_service",
    });
    assert.deepEqual(dashboard.action, {
      kind: "view_booking",
      href: `/bookings/${IN_SERVICE_BOOKING_ID}`,
      label: "View your next appointment",
    });
    assert.deepEqual(dashboard.recentActivity, [
      {
        bookingId: COMPLETED_BOOKING_ID.toString(),
        toStatus: "completed",
        changedAt: new Date("2026-08-30T07:55:00.000Z"),
        actorLabel: "Administrator",
        reason: null,
      },
      {
        bookingId: COMPLETED_BOOKING_ID.toString(),
        toStatus: "in_service",
        changedAt: new Date("2026-08-30T07:55:00.000Z"),
        actorLabel: "Administrator",
        reason: null,
      },
      {
        bookingId: IN_SERVICE_BOOKING_ID.toString(),
        toStatus: "in_service",
        changedAt: new Date("2026-08-30T07:55:00.000Z"),
        actorLabel: "Administrator",
        reason: null,
      },
      {
        bookingId: TIED_BOOKING_ID.toString(),
        toStatus: "confirmed",
        changedAt: new Date("2026-08-30T07:50:00.000Z"),
        actorLabel: "Administrator",
        reason: null,
      },
      {
        bookingId: NEXT_BOOKING_ID.toString(),
        toStatus: "requested",
        changedAt: new Date("2026-08-30T07:45:00.000Z"),
        actorLabel: "Customer",
        reason: null,
      },
    ]);

    assertNoForbiddenKeys(dashboard, new Set([
      "_id", "__v", "customer", "actor", "userId", "username", "email",
      "bayNumber", "reservedSlotKeys", "bookingGuardVersion",
      "password", "passwordHash", "token", "tokenVersion", "vehicleSnapshot",
      "serviceSnapshot", "historyIndex",
    ]));
    const serialized = JSON.stringify(dashboard);
    for (const secret of [
      CUSTOMER_ID,
      FOREIGN_CUSTOMER_ID,
      ADMIN_ID,
      FOREIGN_BOOKING_ID,
      SERVICE_ID,
      "dashboard_customer",
      "foreign_customer",
      "dashboard_admin",
      "TN01FOREIGN",
    ]) {
      assert.equal(serialized.includes(secret.toString()), false, `exposed ${secret}`);
    }

    const after = plainSnapshot({
      bookings: await Booking.find().select("+reservedSlotKeys").sort({ _id: 1 }).lean(),
      vehicles: await Vehicle.find().select("+bookingGuardVersion").sort({ _id: 1 }).lean(),
    });
    assert.deepEqual(after, before);
  });

  test("chooses book-service for active-only and add-vehicle for archived-only customers", async () => {
    assert.deepEqual((await getCustomerDashboard({
      customerId: FOREIGN_CUSTOMER_ID,
      now: NOW,
    })).action, {
      kind: "book_service",
      href: "/book-service",
      label: "Book a service",
    });

    const archived = await getCustomerDashboard({
      customerId: ARCHIVED_CUSTOMER_ID,
      now: NOW,
    });
    assert.deepEqual(archived.summary, {
      activeVehicles: 0,
      upcomingBookings: 0,
      completedBookings: 0,
    });
    assert.deepEqual(archived.action, {
      kind: "add_vehicle",
      href: "/vehicles",
      label: "Add your first vehicle",
    });
  });
});

if (process.env.MONGO_URI_TEST) test.describe("live database: administrator dashboard aggregation", () => {
  const customerId = new mongoose.Types.ObjectId("68b54f1bfc13ae11b3000200");

  function adminBookingDocument({
    id,
    startsAt,
    localDate,
    status,
    durationMinutes = 30,
    hasReservation = true,
  }) {
    const _id = new mongoose.Types.ObjectId(id);
    return {
      _id,
      customer: customerId,
      startsAt,
      localDate,
      status,
      serviceSnapshot: {
        name: `Admin service ${id.slice(-2)}`,
        durationMinutes,
      },
      vehicleSnapshot: {
        registrationNumber: `TN01ADM${id.slice(-2)}`,
      },
      ...(hasReservation ? {
        reservedSlotKeys: [`${startsAt.toISOString()}|booking:${id}`],
      } : {}),
    };
  }

  test.before(async () => {
    await connectTestDb();
    await Promise.all([
      Booking.init(),
      User.init(),
      Vehicle.init(),
      WorkshopSchedule.init(),
    ]);
  });
  test.beforeEach(async () => {
    await clearTestDb();
    await User.create(userFixture({
      _id: customerId,
      username: "admin_attention_customer",
    }));
    await WorkshopSchedule.create(ADMIN_WORKLOAD_SCHEDULE);

    await Booking.collection.insertMany([
      adminBookingDocument({
        id: "68b54f1bfc13ae11b3000201",
        startsAt: new Date("2026-08-29T18:30:00.000Z"),
        localDate: "2026-08-30",
        status: "requested",
      }),
      adminBookingDocument({
        id: "68b54f1bfc13ae11b3000202",
        startsAt: new Date("2026-08-29T18:29:59.999Z"),
        localDate: "2026-08-29",
        status: "requested",
      }),
      adminBookingDocument({
        id: "68b54f1bfc13ae11b3000203",
        startsAt: NOW,
        localDate: "2026-08-30",
        status: "requested",
        durationMinutes: 90,
      }),
      adminBookingDocument({
        id: "68b54f1bfc13ae11b3000204",
        startsAt: new Date("2026-08-31T08:00:00.000Z"),
        localDate: "2026-08-31",
        status: "requested",
      }),
      adminBookingDocument({
        id: "68b54f1bfc13ae11b3000205",
        startsAt: new Date("2026-08-31T08:00:00.001Z"),
        localDate: "2026-08-31",
        status: "requested",
        durationMinutes: 60,
      }),
      adminBookingDocument({
        id: "68b54f1bfc13ae11b3000206",
        startsAt: NOW,
        localDate: "2026-08-30",
        status: "confirmed",
      }),
      adminBookingDocument({
        id: "68b54f1bfc13ae11b3000207",
        startsAt: NOW,
        localDate: "2026-08-30",
        status: "confirmed",
      }),
      adminBookingDocument({
        id: "68b54f1bfc13ae11b3000208",
        startsAt: new Date("2026-08-30T08:00:00.001Z"),
        localDate: "2026-08-30",
        status: "confirmed",
      }),
      adminBookingDocument({
        id: "68b54f1bfc13ae11b3000209",
        startsAt: new Date("2026-09-03T08:00:00.000Z"),
        localDate: "2026-09-03",
        status: "in_service",
      }),
      adminBookingDocument({
        id: "68b54f1bfc13ae11b3000210",
        startsAt: new Date("2026-09-04T08:00:00.000Z"),
        localDate: "2026-09-04",
        status: "in_service",
      }),
      adminBookingDocument({
        id: "68b54f1bfc13ae11b3000211",
        startsAt: NOW,
        localDate: "2026-08-30",
        status: "completed",
        durationMinutes: 90,
      }),
      adminBookingDocument({
        id: "68b54f1bfc13ae11b3000212",
        startsAt: NOW,
        localDate: "2026-08-30",
        status: "cancelled",
        hasReservation: false,
      }),
      adminBookingDocument({
        id: "68b54f1bfc13ae11b3000213",
        startsAt: NOW,
        localDate: "2026-08-30",
        status: "rejected",
        hasReservation: false,
      }),
      adminBookingDocument({
        id: "68b54f1bfc13ae11b3000214",
        startsAt: NOW,
        localDate: "2026-08-30",
        status: "no_show",
        hasReservation: false,
      }),
    ]);
  });
  test.after(disconnectTestDb);

  test("executes live workload and attention predicates without writes", async () => {
    const before = plainSnapshot({
      bookings: await Booking.collection.find({}).sort({ _id: 1 }).toArray(),
      schedules: await WorkshopSchedule.collection.find({}).sort({ _id: 1 }).toArray(),
      users: await User.collection.find({}).sort({ _id: 1 }).toArray(),
    });

    const dashboard = await getAdminDashboard({ now: NOW });

    assert.deepEqual(dashboard.summary, {
      totalBookings: 14,
      todayAppointments: 5,
      byStatus: {
        requested: 5,
        confirmed: 3,
        in_service: 2,
        completed: 1,
        cancelled: 1,
        rejected: 1,
        no_show: 1,
      },
    });
    assert.deepEqual(dashboard.workload, [
      {
        date: "2026-08-30",
        appointmentCount: 5,
        reservedMinutes: 210,
        availableBayMinutes: 960,
        utilizationPercent: 21.9,
      },
      {
        date: "2026-08-31",
        appointmentCount: 2,
        reservedMinutes: 90,
        availableBayMinutes: 240,
        utilizationPercent: 37.5,
      },
      {
        date: "2026-09-01",
        appointmentCount: 0,
        reservedMinutes: 0,
        availableBayMinutes: 0,
        utilizationPercent: 0,
      },
      {
        date: "2026-09-02",
        appointmentCount: 0,
        reservedMinutes: 0,
        availableBayMinutes: 960,
        utilizationPercent: 0,
      },
      {
        date: "2026-09-03",
        appointmentCount: 1,
        reservedMinutes: 30,
        availableBayMinutes: 0,
        utilizationPercent: 0,
      },
      {
        date: "2026-09-04",
        appointmentCount: 1,
        reservedMinutes: 30,
        availableBayMinutes: 0,
        utilizationPercent: 0,
      },
      {
        date: "2026-09-05",
        appointmentCount: 0,
        reservedMinutes: 0,
        availableBayMinutes: 0,
        utilizationPercent: 0,
      },
    ]);
    assert.deepEqual(
      dashboard.attention.map((item) => ({
        kind: item.kind,
        bookingId: item.bookingId,
        startsAt: item.startsAt,
        status: item.status,
        customer: item.customer,
      })),
      [
        {
          kind: "overdue_confirmed",
          bookingId: "68b54f1bfc13ae11b3000206",
          startsAt: NOW,
          status: "confirmed",
          customer: {
            id: customerId.toString(),
            username: "admin_attention_customer",
            email: "admin_attention_customer@example.com",
          },
        },
        {
          kind: "overdue_confirmed",
          bookingId: "68b54f1bfc13ae11b3000207",
          startsAt: NOW,
          status: "confirmed",
          customer: {
            id: customerId.toString(),
            username: "admin_attention_customer",
            email: "admin_attention_customer@example.com",
          },
        },
        {
          kind: "requested_soon",
          bookingId: "68b54f1bfc13ae11b3000203",
          startsAt: NOW,
          status: "requested",
          customer: {
            id: customerId.toString(),
            username: "admin_attention_customer",
            email: "admin_attention_customer@example.com",
          },
        },
        {
          kind: "requested_soon",
          bookingId: "68b54f1bfc13ae11b3000204",
          startsAt: new Date("2026-08-31T08:00:00.000Z"),
          status: "requested",
          customer: {
            id: customerId.toString(),
            username: "admin_attention_customer",
            email: "admin_attention_customer@example.com",
          },
        },
        {
          kind: "in_service",
          bookingId: "68b54f1bfc13ae11b3000209",
          startsAt: new Date("2026-09-03T08:00:00.000Z"),
          status: "in_service",
          customer: {
            id: customerId.toString(),
            username: "admin_attention_customer",
            email: "admin_attention_customer@example.com",
          },
        },
      ],
    );
    assertNoForbiddenKeys(dashboard.attention, new Set([
      "_id",
      "actor",
      "bayNumber",
      "reservedSlotKeys",
      "passwordHash",
      "vehicleSnapshot",
      "serviceSnapshot",
    ]));

    const after = plainSnapshot({
      bookings: await Booking.collection.find({}).sort({ _id: 1 }).toArray(),
      schedules: await WorkshopSchedule.collection.find({}).sort({ _id: 1 }).toArray(),
      users: await User.collection.find({}).sort({ _id: 1 }).toArray(),
    });
    assert.deepEqual(after, before);
  });
});
