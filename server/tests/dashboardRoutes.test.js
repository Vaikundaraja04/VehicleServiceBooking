const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { DateTime } = require("luxon");

const app = require("../app");
const Booking = require("../models/Booking");
const Service = require("../models/Service");
const User = require("../models/User");
const Vehicle = require("../models/Vehicle");
const WorkshopSchedule = require("../models/WorkshopSchedule");
const { WORKSHOP_TIME_ZONE } = require("../config/bookingPolicy");
const dashboardService = require("../services/dashboardService");
const { hashPassword } = require("../services/passwordService");
const {
  defaultWorkshopSchedule,
} = require("../services/workshopScheduleService");
const { buildReservedSlotKeys } = require("../utils/bookingReservation");
const {
  connectTestDb,
  clearTestDb,
  disconnectTestDb,
} = require("./helpers/testDb");

const ORIGIN = "http://localhost:5173";
const PASSWORD = "StrongPass1";
let sequence = 0;

async function createUser(role) {
  sequence += 1;
  return User.create({
    username: `${role}_dashboard_${sequence}`,
    email: `${role}_dashboard_${sequence}@example.com`,
    mobile: role === "customer" ? "9876543210" : undefined,
    address: role === "customer" ? "Chennai" : undefined,
    passwordHash: await hashPassword(PASSWORD),
    role,
    isEmailVerified: true,
    isActive: true,
  });
}

async function login(user) {
  const response = await request(app)
    .post("/api/auth/login")
    .set("Origin", ORIGIN)
    .send({ identifier: user.email, password: PASSWORD });
  assert.equal(response.status, 200);
  return response.headers["set-cookie"][0];
}

async function loginAs(role) {
  const user = await createUser(role);
  return { user, cookie: await login(user) };
}

async function createVehicle(owner, registrationNumber) {
  return Vehicle.create({
    owner: owner._id,
    registrationNumber,
    make: "Tata",
    model: "Nexon",
    year: 2025,
    fuelType: "electric",
    status: "active",
    activeSlot: 1,
  });
}

async function createService() {
  sequence += 1;
  return Service.create({
    name: `Dashboard Maintenance ${sequence}`,
    category: "maintenance",
    description: "Dashboard route integration fixture service.",
    durationMinutes: 60,
  });
}

function nextOpenLocalDate() {
  let local = DateTime.now().setZone(WORKSHOP_TIME_ZONE).plus({ days: 2 }).startOf("day");
  while (local.weekday === 7) local = local.plus({ days: 1 });
  return local;
}

async function createDashboardBooking({ customer, vehicle, service, startsAt, createdAt }) {
  const durationMinutes = service.durationMinutes;
  const endsAt = new Date(startsAt.getTime() + durationMinutes * 60 * 1000);
  return Booking.create({
    customer: customer._id,
    vehicle: vehicle._id,
    vehicleSnapshot: {
      registrationNumber: vehicle.registrationNumber,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year,
      fuelType: vehicle.fuelType,
    },
    service: service._id,
    serviceSnapshot: {
      name: service.name,
      slug: service.slug,
      category: service.category,
      durationMinutes,
    },
    startsAt,
    endsAt,
    localDate: DateTime.fromJSDate(startsAt, { zone: WORKSHOP_TIME_ZONE }).toISODate(),
    timeZone: WORKSHOP_TIME_ZONE,
    bayNumber: 1,
    reservedSlotKeys: buildReservedSlotKeys({ startsAt, durationMinutes, bayNumber: 1 }),
    status: "requested",
    statusHistory: [{
      fromStatus: null,
      toStatus: "requested",
      changedAt: createdAt,
      actor: {
        userId: customer._id,
        username: customer.username,
        role: "customer",
      },
      reason: null,
    }],
  });
}

async function createMixedCustomerFixture() {
  const customer = await createUser("customer");
  const foreignCustomer = await createUser("customer");
  const customerVehicle = await createVehicle(customer, "TN01DA0001");
  const foreignVehicle = await createVehicle(foreignCustomer, "TN01DA9999");
  const service = await createService();
  const localDate = nextOpenLocalDate();
  const customerStartsAt = localDate.set({ hour: 10 }).toUTC().toJSDate();
  const foreignStartsAt = localDate.set({ hour: 11 }).toUTC().toJSDate();
  const createdAt = new Date();
  const customerBooking = await createDashboardBooking({
    customer,
    vehicle: customerVehicle,
    service,
    startsAt: customerStartsAt,
    createdAt,
  });
  const foreignBooking = await createDashboardBooking({
    customer: foreignCustomer,
    vehicle: foreignVehicle,
    service,
    startsAt: foreignStartsAt,
    createdAt,
  });
  return {
    customer,
    foreignCustomer,
    customerVehicle,
    foreignVehicle,
    service,
    localDate: localDate.toISODate(),
    createdAt,
    customerBooking,
    foreignBooking,
  };
}

async function persistedDashboardSourceBytes() {
  const [bookings, vehicles, schedules] = await Promise.all([
    Booking.find({}).select("+reservedSlotKeys").sort({ _id: 1 }).lean(),
    Vehicle.find({}).select("+bookingGuardVersion").sort({ _id: 1 }).lean(),
    WorkshopSchedule.find({}).select("+bookingGuardVersion").sort({ _id: 1 }).lean(),
  ]);
  return JSON.stringify({ bookings, vehicles, schedules });
}

function assertGeneratedAtBounded(generatedAt, before, after) {
  const instant = new Date(generatedAt);
  assert.equal(Number.isNaN(instant.getTime()), false);
  assert.equal(instant >= before, true, `${generatedAt} is before ${before.toISOString()}`);
  assert.equal(instant <= after, true, `${generatedAt} is after ${after.toISOString()}`);
}

function expectedAdminWorkload(generatedAt, scheduledDate) {
  const firstDay = DateTime.fromISO(generatedAt, { zone: WORKSHOP_TIME_ZONE }).startOf("day");
  return Array.from({ length: 7 }, (_unused, index) => {
    const day = firstDay.plus({ days: index });
    const isScheduled = day.toISODate() === scheduledDate;
    const availableBayMinutes = day.weekday === 7 ? 0 : 1080;
    const reservedMinutes = isScheduled ? 120 : 0;
    return {
      date: day.toISODate(),
      appointmentCount: isScheduled ? 2 : 0,
      reservedMinutes,
      availableBayMinutes,
      utilizationPercent: reservedMinutes === 0 ? 0 : 11.1,
    };
  });
}

function getDashboard({ cookie, query = "" } = {}) {
  const pending = request(app).get(`/api/dashboard${query}`);
  return cookie ? pending.set("Cookie", cookie) : pending;
}

test.before(async () => {
  await connectTestDb();
  await Promise.all([
    Booking.init(),
    Service.init(),
    User.init(),
    Vehicle.init(),
    WorkshopSchedule.init(),
  ]);
});
test.beforeEach(async () => {
  await clearTestDb();
  await WorkshopSchedule.create(defaultWorkshopSchedule());
});
test.after(disconnectTestDb);

test("dashboard authenticates before rejecting malformed query input", async () => {
  const response = await getDashboard({ query: "?bad=1" });

  assert.equal(response.status, 401);
  assert.deepEqual(response.body, { message: "Authentication required" });
});

test("dashboard rejects every unknown, repeated, and non-scalar query after authorization", async () => {
  for (const role of ["customer", "admin"]) {
    const { cookie } = await loginAs(role);
    const cases = [
      ["?bad=1", "bad"],
      ["?bad=1&bad=2", "bad"],
      ["?bad[nested]=1", "bad[nested]"],
    ];

    for (const [query, field] of cases) {
      const response = await getDashboard({ cookie, query });
      assert.equal(response.status, 400, `${role} ${query}`);
      assert.deepEqual(response.body, {
        message: "Validation failed",
        errors: [{ field, message: "This query field is not allowed" }],
      }, `${role} ${query}`);
    }
  }
});

test("customer and administrator dashboard responses use only the dashboard envelope", async () => {
  const originalCustomer = dashboardService.getCustomerDashboard;
  const originalAdmin = dashboardService.getAdminDashboard;
  const calls = [];
  dashboardService.getCustomerDashboard = async (input) => {
    calls.push({ kind: "customer", input });
    return { role: "customer", marker: "safe-customer" };
  };
  dashboardService.getAdminDashboard = async (input) => {
    calls.push({ kind: "admin", input });
    return { role: "admin", marker: "safe-admin" };
  };

  try {
    const customer = await loginAs("customer");
    const customerResponse = await getDashboard({ cookie: customer.cookie });
    assert.equal(customerResponse.status, 200);
    assert.deepEqual(customerResponse.body, {
      dashboard: { role: "customer", marker: "safe-customer" },
    });

    const admin = await loginAs("admin");
    const adminResponse = await getDashboard({ cookie: admin.cookie });
    assert.equal(adminResponse.status, 200);
    assert.deepEqual(adminResponse.body, {
      dashboard: { role: "admin", marker: "safe-admin" },
    });

    assert.equal(calls.length, 2);
    assert.equal(calls[0].kind, "customer");
    assert.equal(calls[0].input.customerId.toString(), customer.user.id);
    assert.deepEqual(Object.keys(calls[0].input).sort(), ["customerId", "now"]);
    assert.equal(calls[0].input.now instanceof Date, true);
    assert.equal(calls[1].kind, "admin");
    assert.deepEqual(Object.keys(calls[1].input), ["now"]);
    assert.equal(calls[1].input.now instanceof Date, true);
  } finally {
    dashboardService.getCustomerDashboard = originalCustomer;
    dashboardService.getAdminDashboard = originalAdmin;
  }
});

test("unsupported dashboard methods stay missing and perform no dashboard work", async () => {
  const originalCustomer = dashboardService.getCustomerDashboard;
  const originalAdmin = dashboardService.getAdminDashboard;
  let callCount = 0;
  dashboardService.getCustomerDashboard = async () => {
    callCount += 1;
    return {};
  };
  dashboardService.getAdminDashboard = async () => {
    callCount += 1;
    return {};
  };

  try {
    for (const method of ["post", "patch", "put", "delete"]) {
      const response = await request(app)[method]("/api/dashboard")
        .set("Origin", ORIGIN)
        .send({ role: "admin", now: "2000-01-01T00:00:00.000Z" });
      assert.equal(response.status, 404, method);
      assert.deepEqual(response.body, { message: "Route not found" }, method);
    }
    assert.equal(callCount, 0);
  } finally {
    dashboardService.getCustomerDashboard = originalCustomer;
    dashboardService.getAdminDashboard = originalAdmin;
  }
});

test("live customer and administrator dashboards expose exact safe shapes without writes", async () => {
  const fixture = await createMixedCustomerFixture();
  const customerCookie = await login(fixture.customer);
  const admin = await loginAs("admin");
  const beforeState = await persistedDashboardSourceBytes();

  const customerBefore = new Date();
  const customerResponse = await getDashboard({ cookie: customerCookie });
  const customerAfter = new Date();
  assert.equal(customerResponse.status, 200);
  assert.deepEqual(Object.keys(customerResponse.body), ["dashboard"]);
  assertGeneratedAtBounded(
    customerResponse.body.dashboard.generatedAt,
    customerBefore,
    customerAfter,
  );
  assert.deepEqual(customerResponse.body.dashboard, {
    role: "customer",
    generatedAt: customerResponse.body.dashboard.generatedAt,
    summary: {
      activeVehicles: 1,
      upcomingBookings: 1,
      completedBookings: 0,
    },
    nextBooking: {
      id: fixture.customerBooking.id,
      vehicle: {
        id: fixture.customerVehicle.id,
        registrationNumber: "TN01DA0001",
        make: "Tata",
        model: "Nexon",
        year: 2025,
        fuelType: "electric",
      },
      service: {
        name: fixture.service.name,
        slug: fixture.service.slug,
        category: "maintenance",
        durationMinutes: 60,
      },
      startsAt: fixture.customerBooking.startsAt.toISOString(),
      endsAt: fixture.customerBooking.endsAt.toISOString(),
      localDate: fixture.localDate,
      timeZone: WORKSHOP_TIME_ZONE,
      status: "requested",
    },
    action: {
      kind: "view_booking",
      href: `/bookings/${fixture.customerBooking.id}`,
      label: "View your next appointment",
    },
    recentActivity: [{
      bookingId: fixture.customerBooking.id,
      toStatus: "requested",
      changedAt: fixture.createdAt.toISOString(),
      actorLabel: "Customer",
      reason: null,
    }],
  });
  const customerPayload = JSON.stringify(customerResponse.body);
  for (const foreignSentinel of [
    fixture.foreignCustomer.id,
    fixture.foreignCustomer.email,
    fixture.foreignVehicle.id,
    fixture.foreignVehicle.registrationNumber,
    fixture.foreignBooking.id,
  ]) {
    assert.equal(customerPayload.includes(foreignSentinel), false, foreignSentinel);
  }

  const adminBefore = new Date();
  const adminResponse = await getDashboard({ cookie: admin.cookie });
  const adminAfter = new Date();
  assert.equal(adminResponse.status, 200);
  assert.deepEqual(Object.keys(adminResponse.body), ["dashboard"]);
  assertGeneratedAtBounded(adminResponse.body.dashboard.generatedAt, adminBefore, adminAfter);
  assert.deepEqual(adminResponse.body.dashboard, {
    role: "admin",
    generatedAt: adminResponse.body.dashboard.generatedAt,
    summary: {
      totalBookings: 2,
      todayAppointments: 0,
      byStatus: {
        requested: 2,
        confirmed: 0,
        in_service: 0,
        completed: 0,
        cancelled: 0,
        rejected: 0,
        no_show: 0,
      },
    },
    workload: expectedAdminWorkload(
      adminResponse.body.dashboard.generatedAt,
      fixture.localDate,
    ),
    attention: [],
  });

  assert.equal(await persistedDashboardSourceBytes(), beforeState);
});

test("authentication reloads the current database role before selecting a dashboard", async () => {
  const customer = await createUser("customer");
  const cookie = await login(customer);
  await User.updateOne({ _id: customer._id }, { $set: { role: "admin" } });

  const response = await getDashboard({ cookie });

  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(response.body.dashboard), [
    "role",
    "generatedAt",
    "summary",
    "workload",
    "attention",
  ]);
  assert.equal(response.body.dashboard.role, "admin");
  assert.equal(Object.hasOwn(response.body.dashboard, "nextBooking"), false);
});

test("dashboard database failures propagate to the centralized controlled 500", async () => {
  const originalAggregate = Booking.aggregate;
  Booking.aggregate = async () => {
    throw new Error("private database failure details");
  };

  try {
    const { cookie } = await loginAs("customer");
    const response = await getDashboard({ cookie });
    assert.equal(response.status, 500);
    assert.deepEqual(response.body, { message: "Internal server error" });
    assert.equal(Object.hasOwn(response.body, "stack"), false);
    assert.equal(JSON.stringify(response.body).includes("private database"), false);
  } finally {
    Booking.aggregate = originalAggregate;
  }
});
