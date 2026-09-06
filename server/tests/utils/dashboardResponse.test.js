const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const { BOOKING_STATUSES } = require("../../config/bookingPolicy");
const {
  toCustomerDashboard,
  toAdminDashboard,
} = require("../../utils/dashboardResponse");

function assertNoForbiddenKeys(value, forbiddenKeys) {
  if (Array.isArray(value)) {
    value.forEach((entry) => assertNoForbiddenKeys(entry, forbiddenKeys));
    return;
  }

  if (value && typeof value === "object" && !(value instanceof Date)) {
    for (const [key, nestedValue] of Object.entries(value)) {
      assert.equal(forbiddenKeys.has(key), false, `forbidden key: ${key}`);
      assertNoForbiddenKeys(nestedValue, forbiddenKeys);
    }
  }
}

function customerBookingFixture(overrides = {}) {
  const bookingId = new mongoose.Types.ObjectId();
  const vehicleId = new mongoose.Types.ObjectId();
  const customerId = new mongoose.Types.ObjectId();

  return {
    _id: bookingId,
    __v: 4,
    customer: {
      _id: customerId,
      username: "customer_one",
      email: "customer@example.invalid",
      password: "never-expose",
      token: "never-expose",
    },
    vehicle: vehicleId,
    vehicleSnapshot: {
      registrationNumber: "TN01AB1234",
      make: "Tata",
      model: "Nexon",
      year: 2024,
      fuelType: "petrol",
      password: "never-expose",
      token: "never-expose",
    },
    serviceSnapshot: {
      name: "Full service",
      slug: "full-service",
      category: "maintenance",
      durationMinutes: 90,
      password: "never-expose",
      token: "never-expose",
    },
    startsAt: new Date("2026-08-31T04:30:00.000Z"),
    endsAt: new Date("2026-08-31T06:00:00.000Z"),
    localDate: "2026-08-31",
    timeZone: "Asia/Kolkata",
    status: "confirmed",
    bayNumber: 2,
    reservedSlotKeys: ["2026-08-31T04:30:00.000Z|bay:2"],
    bookingGuardVersion: 3,
    password: "never-expose",
    token: "never-expose",
    ...overrides,
  };
}

function customerActivityFixture(bookingId, overrides = {}) {
  return {
    bookingId,
    _id: new mongoose.Types.ObjectId(),
    __v: 4,
    toStatus: "confirmed",
    changedAt: new Date("2026-08-30T07:00:00.000Z"),
    actor: {
      userId: new mongoose.Types.ObjectId(),
      username: "admin_one",
      role: "admin",
      password: "never-expose",
      token: "never-expose",
    },
    customer: { password: "never-expose", token: "never-expose" },
    bayNumber: 2,
    reservedSlotKeys: ["never-expose"],
    bookingGuardVersion: 3,
    password: "never-expose",
    token: "never-expose",
    ...overrides,
  };
}

test("customer dashboard returns the exact approved allowlist projection", () => {
  const booking = customerBookingFixture();
  const activity = [customerActivityFixture(booking._id)];

  assert.deepEqual(toCustomerDashboard({
    now: new Date("2026-08-30T08:00:00.000Z"),
    activeVehicles: 2,
    upcomingBookings: 1,
    completedBookings: 3,
    nextBooking: booking,
    recentActivity: activity,
  }), {
    role: "customer",
    generatedAt: new Date("2026-08-30T08:00:00.000Z"),
    summary: { activeVehicles: 2, upcomingBookings: 1, completedBookings: 3 },
    nextBooking: {
      id: booking._id.toString(),
      vehicle: {
        id: booking.vehicle.toString(),
        registrationNumber: "TN01AB1234",
        make: "Tata",
        model: "Nexon",
        year: 2024,
        fuelType: "petrol",
      },
      service: {
        name: "Full service",
        slug: "full-service",
        category: "maintenance",
        durationMinutes: 90,
      },
      startsAt: new Date("2026-08-31T04:30:00.000Z"),
      endsAt: new Date("2026-08-31T06:00:00.000Z"),
      localDate: "2026-08-31",
      timeZone: "Asia/Kolkata",
      status: "confirmed",
    },
    action: {
      kind: "view_booking",
      href: `/bookings/${booking._id}`,
      label: "View your next appointment",
    },
    recentActivity: [{
      bookingId: booking._id.toString(),
      toStatus: "confirmed",
      changedAt: new Date("2026-08-30T07:00:00.000Z"),
      actorLabel: "Administrator",
      reason: null,
    }],
  });
});

test("customer dashboard selects the remaining closed action enum values", () => {
  assert.deepEqual(toCustomerDashboard({
    now: new Date("2026-08-30T08:00:00.000Z"),
    activeVehicles: 1,
    upcomingBookings: 0,
    completedBookings: 0,
    nextBooking: null,
    recentActivity: [],
  }).action, {
    kind: "book_service",
    href: "/book-service",
    label: "Book a service",
  });

  assert.deepEqual(toCustomerDashboard({
    now: new Date("2026-08-30T08:00:00.000Z"),
    activeVehicles: 0,
    upcomingBookings: 0,
    completedBookings: 0,
    nextBooking: null,
    recentActivity: [],
  }).action, {
    kind: "add_vehicle",
    href: "/vehicles",
    label: "Add your first vehicle",
  });
});

test("customer dashboard preserves the newest five activity inputs and isolates values", () => {
  const booking = customerBookingFixture();
  const activity = Array.from({ length: 6 }, (_value, index) => customerActivityFixture(
    booking._id,
    {
      toStatus: `status-${index}`,
      changedAt: new Date(`2026-08-30T0${index}:00:00.000Z`),
      reason: undefined,
    },
  ));
  const now = new Date("2026-08-30T08:00:00.000Z");
  const dashboard = toCustomerDashboard({
    now,
    activeVehicles: 1,
    upcomingBookings: 1,
    completedBookings: 0,
    nextBooking: booking,
    recentActivity: activity,
  });

  assert.deepEqual(dashboard.recentActivity.map(({ toStatus }) => toStatus), [
    "status-0", "status-1", "status-2", "status-3", "status-4",
  ]);
  assert.equal(dashboard.recentActivity[0].reason, null);
  assert.notStrictEqual(dashboard.generatedAt, now);
  assert.notStrictEqual(dashboard.nextBooking.startsAt, booking.startsAt);
  assert.notStrictEqual(dashboard.recentActivity[0].changedAt, activity[0].changedAt);

  dashboard.generatedAt.setUTCFullYear(2000);
  dashboard.nextBooking.vehicle.make = "Changed";
  dashboard.recentActivity[0].changedAt.setUTCFullYear(2000);
  assert.equal(now.getUTCFullYear(), 2026);
  assert.equal(booking.vehicleSnapshot.make, "Tata");
  assert.equal(activity[0].changedAt.getUTCFullYear(), 2026);
});

test("customer dashboard recursively omits identity and internal fields", () => {
  const booking = customerBookingFixture();
  const dashboard = toCustomerDashboard({
    now: new Date("2026-08-30T08:00:00.000Z"),
    activeVehicles: 1,
    upcomingBookings: 1,
    completedBookings: 0,
    nextBooking: booking,
    recentActivity: [customerActivityFixture(booking._id)],
  });

  assertNoForbiddenKeys(dashboard, new Set([
    "_id", "__v", "customer", "actor", "userId", "username", "email",
    "bayNumber", "reservedSlotKeys", "bookingGuardVersion", "password", "token",
    "vehicleSnapshot", "serviceSnapshot",
  ]));
});

function workloadFixture(index, overrides = {}) {
  return {
    date: `2026-08-${String(30 + index).padStart(2, "0")}`,
    appointmentCount: index + 1,
    reservedMinutes: (index + 1) * 30,
    availableBayMinutes: 960,
    utilizationPercent: (index + 1) * 3.1,
    bayNumber: 2,
    reservedSlotKeys: ["never-expose"],
    bookingGuardVersion: 3,
    password: "never-expose",
    token: "never-expose",
    ...overrides,
  };
}

function attentionFixture(overrides = {}) {
  const bookingId = new mongoose.Types.ObjectId();
  const customerId = new mongoose.Types.ObjectId();

  return {
    _id: bookingId,
    __v: 4,
    kind: "overdue_confirmed",
    startsAt: new Date("2026-08-30T07:30:00.000Z"),
    status: "confirmed",
    customer: {
      _id: customerId,
      username: "demo_customer",
      email: "demo@example.invalid",
      password: "never-expose",
      token: "never-expose",
    },
    vehicleSnapshot: {
      registrationNumber: "TN01AB1234",
      password: "never-expose",
      token: "never-expose",
    },
    serviceSnapshot: {
      name: "Full service",
      password: "never-expose",
      token: "never-expose",
    },
    actor: { userId: new mongoose.Types.ObjectId(), username: "admin_one" },
    bayNumber: 2,
    reservedSlotKeys: ["never-expose"],
    bookingGuardVersion: 3,
    password: "never-expose",
    token: "never-expose",
    ...overrides,
  };
}

test("administrator dashboard returns the exact safe workload and attention projection", () => {
  const attention = attentionFixture();
  const dashboard = toAdminDashboard({
    now: new Date("2026-08-30T08:00:00.000Z"),
    totalBookings: 18,
    todayAppointments: 4,
    byStatus: {
      requested: 3,
      confirmed: 5,
      in_service: 1,
      completed: 6,
      cancelled: 1,
      rejected: 1,
      no_show: 1,
      unknown: 99,
    },
    workload: Array.from({ length: 8 }, (_value, index) => workloadFixture(index)),
    attention: [attention],
  });

  assert.deepEqual(dashboard, {
    role: "admin",
    generatedAt: new Date("2026-08-30T08:00:00.000Z"),
    summary: {
      totalBookings: 18,
      todayAppointments: 4,
      byStatus: {
        requested: 3,
        confirmed: 5,
        in_service: 1,
        completed: 6,
        cancelled: 1,
        rejected: 1,
        no_show: 1,
      },
    },
    workload: Array.from({ length: 7 }, (_value, index) => ({
      date: `2026-08-${String(30 + index).padStart(2, "0")}`,
      appointmentCount: index + 1,
      reservedMinutes: (index + 1) * 30,
      availableBayMinutes: 960,
      utilizationPercent: (index + 1) * 3.1,
    })),
    attention: [{
      kind: "overdue_confirmed",
      bookingId: attention._id.toString(),
      startsAt: new Date("2026-08-30T07:30:00.000Z"),
      status: "confirmed",
      customer: {
        id: attention.customer._id.toString(),
        username: "demo_customer",
        email: "demo@example.invalid",
      },
      vehicleRegistrationNumber: "TN01AB1234",
      serviceName: "Full service",
      href: `/admin/bookings/${attention._id}`,
    }],
  });
  assert.deepEqual(Object.keys(dashboard.summary.byStatus), BOOKING_STATUSES);
});

test("administrator dashboard zero-fills statuses and isolates nested values", () => {
  const now = new Date("2026-08-30T08:00:00.000Z");
  const workload = [workloadFixture(0)];
  const attention = attentionFixture({
    kind: "requested_soon",
    startsAt: new Date("2026-08-30T09:00:00.000Z"),
    status: "requested",
  });
  const dashboard = toAdminDashboard({
    now,
    totalBookings: 1,
    todayAppointments: 1,
    byStatus: { confirmed: 1 },
    workload,
    attention: [attention],
  });

  assert.deepEqual(dashboard.summary.byStatus, {
    requested: 0,
    confirmed: 1,
    in_service: 0,
    completed: 0,
    cancelled: 0,
    rejected: 0,
    no_show: 0,
  });
  assert.equal(dashboard.attention[0].kind, "requested_soon");
  assert.notStrictEqual(dashboard.generatedAt, now);
  assert.notStrictEqual(dashboard.workload[0], workload[0]);
  assert.notStrictEqual(dashboard.attention[0].startsAt, attention.startsAt);
  assert.notStrictEqual(dashboard.attention[0].customer, attention.customer);

  dashboard.generatedAt.setUTCFullYear(2000);
  dashboard.workload[0].appointmentCount = 99;
  dashboard.attention[0].startsAt.setUTCFullYear(2000);
  dashboard.attention[0].customer.username = "changed";
  assert.equal(now.getUTCFullYear(), 2026);
  assert.equal(workload[0].appointmentCount, 1);
  assert.equal(attention.startsAt.getUTCFullYear(), 2026);
  assert.equal(attention.customer.username, "demo_customer");
});

test("administrator dashboard recursively omits all non-documented identity and internal fields", () => {
  const dashboard = toAdminDashboard({
    now: new Date("2026-08-30T08:00:00.000Z"),
    totalBookings: 1,
    todayAppointments: 1,
    byStatus: {},
    workload: [workloadFixture(0)],
    attention: [attentionFixture({ kind: "in_service", status: "in_service" })],
  });

  assert.equal(dashboard.attention[0].kind, "in_service");
  assertNoForbiddenKeys(dashboard, new Set([
    "_id", "__v", "actor", "userId", "bayNumber", "reservedSlotKeys",
    "bookingGuardVersion", "password", "token", "vehicleSnapshot", "serviceSnapshot",
  ]));
});
