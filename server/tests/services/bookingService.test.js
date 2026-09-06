const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const Booking = require("../../models/Booking");
const Service = require("../../models/Service");
const User = require("../../models/User");
const Vehicle = require("../../models/Vehicle");
const WorkshopSchedule = require("../../models/WorkshopSchedule");
const {
  createBookingService,
  createBooking,
  cancelBooking,
} = require("../../services/bookingService");
const {
  defaultWorkshopSchedule,
  ensureDefaultWorkshopSchedule,
} = require("../../services/workshopScheduleService");
const {
  connectTestDb,
  clearTestDb,
  disconnectTestDb,
} = require("../helpers/testDb");

const CUSTOMER_ID = new mongoose.Types.ObjectId("68b54f1bfc13ae11b2000001");
const OTHER_CUSTOMER_ID = new mongoose.Types.ObjectId("68b54f1bfc13ae11b2000002");
const VEHICLE_ID = new mongoose.Types.ObjectId("68b54f1bfc13ae11b2000003");
const SERVICE_ID = new mongoose.Types.ObjectId("68b54f1bfc13ae11b2000004");
const BOOKING_ID = new mongoose.Types.ObjectId("68b54f1bfc13ae11b2000005");
const NOW = new Date("2026-08-29T00:00:00.000Z");
const STARTS_AT = new Date("2026-09-01T03:30:00.000Z");

const customer = {
  _id: CUSTOMER_ID,
  username: "booking_customer",
  role: "customer",
};
const admin = {
  _id: OTHER_CUSTOMER_ID,
  username: "workshop_admin",
  role: "admin",
};

function scheduleFixture(overrides = {}) {
  return { _id: "schedule-1", ...defaultWorkshopSchedule(), ...overrides };
}

function vehicleFixture(overrides = {}) {
  return {
    _id: VEHICLE_ID,
    owner: CUSTOMER_ID,
    registrationNumber: "KA01AB1234",
    make: "Tata",
    model: "Nexon",
    year: 2022,
    fuelType: "petrol",
    status: "active",
    ...overrides,
  };
}

function serviceFixture(overrides = {}) {
  return {
    _id: SERVICE_ID,
    name: "Periodic Maintenance",
    slug: "periodic-maintenance",
    category: "maintenance",
    durationMinutes: 90,
    isActive: true,
    ...overrides,
  };
}

function thenableQuery(value, capture = {}) {
  return {
    sort(sort) {
      capture.sort = sort;
      return this;
    },
    skip(skip) {
      capture.skip = skip;
      return this;
    },
    limit(limit) {
      capture.limit = limit;
      return this;
    },
    select(selection) {
      capture.select = selection;
      return this;
    },
    session(session) {
      capture.session = session;
      return this;
    },
    lean() {
      capture.lean = true;
      return Promise.resolve(value);
    },
    populate(path, selection) {
      capture.populate = [path, selection];
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve(value).then(resolve, reject);
    },
  };
}

function creationHarness({
  createResults = [],
  vehicleResult = vehicleFixture(),
  activeServiceResult = serviceFixture(),
  serviceExists = false,
  scheduleResult = scheduleFixture(),
  transactionRunner,
  currentDate = () => NOW,
} = {}) {
  const capture = {
    creates: [],
    events: [],
    scheduleTouches: [],
    serviceTouches: [],
    vehicleTouches: [],
  };
  let createIndex = 0;
  let sessionCount = 0;

  const BookingDouble = {
    async create(documents, options) {
      capture.creates.push({ documents, options });
      const configured = createResults[createIndex];
      createIndex += 1;
      if (configured instanceof Error) throw configured;
      const value = configured || { _id: BOOKING_ID, ...documents[0] };
      return [value];
    },
  };
  const VehicleDouble = {
    findOneAndUpdate(filter, update, options) {
      capture.vehicleTouches.push({ filter, update, options });
      return Promise.resolve(vehicleResult);
    },
  };
  const ServiceDouble = {
    exists(filter) {
      capture.serviceExistsFilter = filter;
      return thenableQuery(serviceExists ? { _id: SERVICE_ID } : null, capture.serviceExistsQuery ||= {});
    },
  };
  const startSession = async () => {
    sessionCount += 1;
    const session = {
      id: `session-${sessionCount}`,
      async withTransaction(callback) {
        capture.events.push(`transaction-start:${this.id}`);
        try {
          const result = transactionRunner
            ? await transactionRunner({ callback, session: this, capture })
            : await callback();
          capture.events.push(`transaction-commit:${this.id}`);
          return result;
        } catch (error) {
          capture.events.push(`transaction-abort:${this.id}`);
          throw error;
        }
      },
      async endSession() {
        capture.events.push(`session-end:${this.id}`);
      },
    };
    capture.events.push(`session-open:${session.id}`);
    return session;
  };

  const service = createBookingService({
    Booking: BookingDouble,
    Service: ServiceDouble,
    Vehicle: VehicleDouble,
    User: {},
    currentDate,
    isValidObjectId: mongoose.isObjectIdOrHexString,
    startSession,
    async touchActiveService({ serviceId, session }) {
      capture.serviceTouches.push({ serviceId, session });
      return activeServiceResult;
    },
    async touchWorkshopSchedule({ session }) {
      capture.scheduleTouches.push({ session });
      return scheduleResult;
    },
  });
  return { capture, service };
}

test("createBooking derives every managed field and retries a collision in a fresh transaction", async () => {
  const duplicate = Object.assign(new Error("reserved collision"), {
    code: 11000,
    index: "uniq_booking_reserved_slot",
  });
  const { capture, service } = creationHarness({ createResults: [duplicate] });

  const booking = await service.createBooking({
    customer,
    vehicleId: VEHICLE_ID,
    serviceId: SERVICE_ID,
    startsAt: STARTS_AT,
    notes: " Battery check ",
    now: NOW,
    endsAt: new Date("2099-01-01T00:00:00.000Z"),
    bayNumber: 5,
    durationMinutes: 30,
    localDate: "2099-01-01",
    timeZone: "UTC",
    vehicleSnapshot: { make: "Attacker" },
    serviceSnapshot: { name: "Attacker" },
    status: "completed",
    reservedSlotKeys: ["attacker"],
    statusHistory: [],
  });

  assert.equal(capture.creates.length, 2);
  const inserted = capture.creates[1].documents[0];
  assert.deepEqual(inserted, {
    customer: CUSTOMER_ID,
    vehicle: VEHICLE_ID,
    vehicleSnapshot: {
      registrationNumber: "KA01AB1234",
      make: "Tata",
      model: "Nexon",
      year: 2022,
      fuelType: "petrol",
    },
    service: SERVICE_ID,
    serviceSnapshot: {
      name: "Periodic Maintenance",
      slug: "periodic-maintenance",
      category: "maintenance",
      durationMinutes: 90,
    },
    startsAt: STARTS_AT,
    endsAt: new Date("2026-09-01T05:00:00.000Z"),
    localDate: "2026-09-01",
    timeZone: "Asia/Kolkata",
    bayNumber: 2,
    reservedSlotKeys: [
      "2026-09-01T03:30:00.000Z|bay:2",
      "2026-09-01T04:00:00.000Z|bay:2",
      "2026-09-01T04:30:00.000Z|bay:2",
    ],
    status: "requested",
    notes: " Battery check ",
    statusHistory: [{
      fromStatus: null,
      toStatus: "requested",
      changedAt: NOW,
      actor: {
        userId: CUSTOMER_ID,
        username: "booking_customer",
        role: "customer",
      },
      reason: null,
    }],
  });
  assert.notEqual(capture.creates[0].options.session, capture.creates[1].options.session);
  assert.deepEqual(capture.creates.map(({ options }) => Object.keys(options)), [["session"], ["session"]]);
  for (const touch of capture.vehicleTouches) {
    assert.deepEqual(touch.filter, {
      _id: VEHICLE_ID,
      owner: CUSTOMER_ID,
      status: "active",
    });
    assert.deepEqual(touch.update, { $inc: { bookingGuardVersion: 1 } });
    assert.deepEqual(touch.options, {
      new: true,
      session: touch.options.session,
      timestamps: false,
    });
  }
  assert.deepEqual(capture.events, [
    "session-open:session-1",
    "transaction-start:session-1",
    "transaction-abort:session-1",
    "session-end:session-1",
    "session-open:session-2",
    "transaction-start:session-2",
    "transaction-commit:session-2",
    "session-end:session-2",
  ]);
  assert.equal(booking.status, "requested");
  assert.equal(booking.bayNumber, 2);
  assert.equal(booking.reservedSlotKeys, undefined);
});

test("createBooking resolves one omitted now across driver transaction retries", async () => {
  let clockReads = 0;
  let callbackRuns = 0;
  const { capture, service } = creationHarness({
    currentDate() {
      clockReads += 1;
      return NOW;
    },
    async transactionRunner({ callback }) {
      callbackRuns += 2;
      await callback();
      return callback();
    },
  });

  await service.createBooking({ customer, vehicleId: VEHICLE_ID, serviceId: SERVICE_ID, startsAt: STARTS_AT });

  assert.equal(clockReads, 1);
  assert.equal(callbackRuns, 2);
  assert.equal(capture.creates.length, 2);
  assert.equal(capture.creates[0].documents[0].statusHistory[0].changedAt, NOW);
  assert.equal(capture.creates[1].documents[0].statusHistory[0].changedAt, NOW);
});

test("createBooking maps guarded source failures exactly and always closes the session", async () => {
  const cases = [
    {
      options: { vehicleResult: null },
      statusCode: 404,
      message: "Vehicle not found",
    },
    {
      options: { activeServiceResult: null, serviceExists: false },
      statusCode: 404,
      message: "Service not found",
    },
    {
      options: { activeServiceResult: null, serviceExists: true },
      statusCode: 409,
      message: "This service is currently unavailable",
    },
    {
      options: { scheduleResult: null },
      statusCode: 503,
      message: "Workshop schedule is unavailable",
    },
  ];

  for (const expected of cases) {
    const { capture, service } = creationHarness(expected.options);
    await assert.rejects(
      service.createBooking({ customer, vehicleId: VEHICLE_ID, serviceId: SERVICE_ID, startsAt: STARTS_AT, now: NOW }),
      (error) => error.statusCode === expected.statusCode && error.message === expected.message,
    );
    assert.equal(capture.events.at(-1), "session-end:session-1");
    assert.equal(capture.events.includes("transaction-commit:session-1"), false);
  }
});

test("createBooking maps malformed and foreign identifiers without leaking ownership", async () => {
  for (const input of [
    { customer: { ...customer, _id: "invalid" }, vehicleId: VEHICLE_ID, serviceId: SERVICE_ID },
    { customer, vehicleId: "invalid", serviceId: SERVICE_ID },
  ]) {
    const { service } = creationHarness();
    await assert.rejects(
      service.createBooking({ ...input, startsAt: STARTS_AT, now: NOW }),
      (error) => error.statusCode === 404 && error.message === "Vehicle not found",
    );
  }

  const { service } = creationHarness();
  await assert.rejects(
    service.createBooking({ customer, vehicleId: VEHICLE_ID, serviceId: "invalid", startsAt: STARTS_AT, now: NOW }),
    (error) => error.statusCode === 404 && error.message === "Service not found",
  );
});

test("createBooking aborts the guard touches at current bayCount and never tries a higher bay", async () => {
  const duplicate = Object.assign(new Error("reserved collision"), {
    code: 11000,
    keyPattern: { reservedSlotKeys: 1 },
  });
  const { capture, service } = creationHarness({
    createResults: [duplicate],
    scheduleResult: scheduleFixture({ bayCount: 1 }),
  });

  await assert.rejects(
    service.createBooking({ customer, vehicleId: VEHICLE_ID, serviceId: SERVICE_ID, startsAt: STARTS_AT, now: NOW }),
    (error) => error.statusCode === 409 && error.message === "That time is no longer available",
  );

  assert.equal(capture.creates.length, 1);
  assert.equal(capture.vehicleTouches.length, 2);
  assert.equal(capture.serviceTouches.length, 2);
  assert.equal(capture.scheduleTouches.length, 2);
  assert.deepEqual(capture.events.slice(-4), [
    "session-open:session-2",
    "transaction-start:session-2",
    "transaction-abort:session-2",
    "session-end:session-2",
  ]);
});

test("createBooking retries five reservation collisions but propagates every unrelated duplicate", async () => {
  const reservationDuplicate = () => Object.assign(new Error("reserved collision"), {
    code: 11000,
    indexName: "uniq_booking_reserved_slot",
  });
  const full = creationHarness({
    createResults: Array.from({ length: 5 }, reservationDuplicate),
    scheduleResult: scheduleFixture({ bayCount: 5 }),
  });
  await assert.rejects(
    full.service.createBooking({ customer, vehicleId: VEHICLE_ID, serviceId: SERVICE_ID, startsAt: STARTS_AT, now: NOW }),
    (error) => error.statusCode === 409 && error.message === "That time is no longer available",
  );
  assert.equal(full.capture.creates.length, 5);
  assert.equal(full.capture.events.filter((event) => event.startsWith("session-end:")).length, 5);

  const unrelated = Object.assign(new Error("email collision"), {
    code: 11000,
    keyPattern: { email: 1 },
  });
  const failure = creationHarness({ createResults: [unrelated] });
  await assert.rejects(
    failure.service.createBooking({ customer, vehicleId: VEHICLE_ID, serviceId: SERVICE_ID, startsAt: STARTS_AT, now: NOW }),
    (error) => error === unrelated,
  );
  assert.equal(failure.capture.creates.length, 1);
  assert.equal(failure.capture.events.at(-1), "session-end:session-1");
});

function readHarness({
  bookingRows = [{ _id: BOOKING_ID }],
  count = 41,
  findOneResult = { _id: BOOKING_ID },
  matchingUsers = [{ _id: CUSTOMER_ID }],
} = {}) {
  const capture = { findMany: [], findOne: [], userFind: [] };
  const BookingDouble = {
    countDocuments(filter) {
      capture.countFilter = filter;
      return Promise.resolve(count);
    },
    find(filter) {
      capture.findMany.push(filter);
      capture.listQuery = {};
      return thenableQuery(bookingRows, capture.listQuery);
    },
    findOne(filter) {
      capture.findOne.push(filter);
      capture.oneQuery = {};
      return thenableQuery(findOneResult, capture.oneQuery);
    },
  };
  const UserDouble = {
    find(filter) {
      capture.userFind.push(filter);
      capture.userQuery = {};
      return thenableQuery(matchingUsers, capture.userQuery);
    },
  };
  const service = createBookingService({
    Booking: BookingDouble,
    Service: {},
    User: UserDouble,
    Vehicle: {},
    currentDate: () => NOW,
    isValidObjectId: mongoose.isObjectIdOrHexString,
    startSession: async () => { throw new Error("not used"); },
    touchActiveService: async () => { throw new Error("not used"); },
    touchWorkshopSchedule: async () => { throw new Error("not used"); },
  });
  return { capture, service };
}

test("listCustomerBookings defaults to exhaustive upcoming scope and ascending pagination", async () => {
  const { capture, service } = readHarness();
  const result = await service.listCustomerBookings({ customer, page: 2, limit: 10, now: NOW });

  assert.deepEqual(capture.countFilter, {
    customer: CUSTOMER_ID,
    $or: [
      { status: { $in: ["requested", "confirmed"] }, endsAt: { $gte: NOW } },
      { status: "in_service" },
    ],
  });
  assert.deepEqual(capture.findMany[0], capture.countFilter);
  assert.deepEqual(capture.listQuery.sort, { startsAt: 1, _id: 1 });
  assert.equal(capture.listQuery.skip, 10);
  assert.equal(capture.listQuery.limit, 10);
  assert.deepEqual(result, {
    bookings: [{ _id: BOOKING_ID }],
    pagination: { page: 2, limit: 10, totalItems: 41, totalPages: 5 },
  });
});

test("listCustomerBookings keeps history disjoint and composes optional status", async () => {
  const history = readHarness();
  await history.service.listCustomerBookings({
    customer,
    scope: "history",
    status: "confirmed",
    now: NOW,
  });
  assert.deepEqual(history.capture.countFilter, {
    customer: CUSTOMER_ID,
    status: "confirmed",
    $or: [
      { status: { $in: ["completed", "cancelled", "rejected", "no_show"] } },
      { status: { $in: ["requested", "confirmed"] }, endsAt: { $lt: NOW } },
    ],
  });
  assert.deepEqual(history.capture.listQuery.sort, { startsAt: -1, _id: -1 });

  const all = readHarness({ count: 0, bookingRows: [] });
  const result = await all.service.listCustomerBookings({ customer, scope: "all" });
  assert.deepEqual(all.capture.countFilter, { customer: CUSTOMER_ID });
  assert.deepEqual(all.capture.listQuery.sort, { startsAt: -1, _id: -1 });
  assert.deepEqual(result.pagination, {
    page: 1,
    limit: 20,
    totalItems: 0,
    totalPages: 0,
  });
});

test("customer and admin details use safe id handling and indistinguishable ownership errors", async () => {
  const invalid = readHarness();
  for (const invoke of [
    () => invalid.service.getCustomerBooking({ customer, bookingId: "bad" }),
    () => invalid.service.getCustomerBooking({ customer: { ...customer, _id: "bad" }, bookingId: BOOKING_ID }),
    () => invalid.service.getAdminBooking({ bookingId: "bad" }),
  ]) {
    await assert.rejects(invoke(), (error) => error.statusCode === 404 && error.message === "Booking not found");
  }
  assert.equal(invalid.capture.findOne.length, 0);

  const missing = readHarness({ findOneResult: null });
  await assert.rejects(
    missing.service.getCustomerBooking({ customer, bookingId: BOOKING_ID }),
    (error) => error.statusCode === 404 && error.message === "Booking not found",
  );
  assert.deepEqual(missing.capture.findOne[0], { _id: BOOKING_ID, customer: CUSTOMER_ID });

  const found = readHarness({ findOneResult: { _id: BOOKING_ID, customer: CUSTOMER_ID } });
  const booking = await found.service.getAdminBooking({ bookingId: BOOKING_ID });
  assert.equal(booking._id, BOOKING_ID);
  assert.deepEqual(found.capture.findOne[0], { _id: BOOKING_ID });
  assert.deepEqual(found.capture.oneQuery.populate, ["customer", "username email"]);
});

test("listAdminBookings composes status, inclusive workshop dates, escaped search, and identity population", async () => {
  const { capture, service } = readHarness({ count: 21 });
  const result = await service.listAdminBookings({
    page: 2,
    limit: 10,
    status: "confirmed",
    dateFrom: "2026-09-01",
    dateTo: "2026-09-02",
    search: "  oil.*(change)  ",
  });

  assert.equal(capture.userFind.length, 1);
  assert.equal(capture.userFind[0].$or[0].username.source, "oil\\.\\*\\(change\\)");
  assert.equal(capture.userFind[0].$or[0].username.flags, "i");
  assert.equal(capture.userFind[0].$or[1].email.source, "oil\\.\\*\\(change\\)");
  assert.equal(capture.userQuery.select, "_id");
  assert.equal(capture.userQuery.lean, true);
  assert.equal(capture.countFilter.status, "confirmed");
  assert.deepEqual(capture.countFilter.startsAt, {
    $gte: new Date("2026-08-31T18:30:00.000Z"),
    $lt: new Date("2026-09-02T18:30:00.000Z"),
  });
  assert.equal(capture.countFilter.$or[0]["vehicleSnapshot.registrationNumber"].source, "oil\\.\\*\\(change\\)");
  assert.equal(capture.countFilter.$or[1]["serviceSnapshot.name"].source, "oil\\.\\*\\(change\\)");
  assert.deepEqual(capture.countFilter.$or[2], { customer: { $in: [CUSTOMER_ID] } });
  assert.deepEqual(capture.findMany[0], capture.countFilter);
  assert.deepEqual(capture.listQuery.sort, { startsAt: 1, _id: 1 });
  assert.equal(capture.listQuery.skip, 10);
  assert.equal(capture.listQuery.limit, 10);
  assert.deepEqual(capture.listQuery.populate, ["customer", "username email"]);
  assert.deepEqual(result.pagination, {
    page: 2,
    limit: 10,
    totalItems: 21,
    totalPages: 3,
  });
});

function transitionHarness({ current, updated, currentDate = () => NOW } = {}) {
  const capture = { findOne: [], updates: [] };
  const currentBooking = current === undefined ? {
    _id: BOOKING_ID,
    customer: CUSTOMER_ID,
    status: "requested",
    startsAt: STARTS_AT,
  } : current;
  const updatedBooking = updated === undefined ? {
    ...currentBooking,
    status: "cancelled",
    reservedSlotKeys: ["must-not-leak"],
  } : updated;
  const BookingDouble = {
    findOne(filter) {
      capture.findOne.push(filter);
      return Promise.resolve(currentBooking);
    },
    findOneAndUpdate(filter, update, options) {
      capture.updates.push({ filter, update, options });
      capture.updateQuery = {};
      return thenableQuery(updatedBooking, capture.updateQuery);
    },
  };
  const service = createBookingService({
    Booking: BookingDouble,
    Service: {},
    User: {},
    Vehicle: {},
    currentDate,
    isValidObjectId: mongoose.isObjectIdOrHexString,
    startSession: async () => { throw new Error("not used"); },
    touchActiveService: async () => { throw new Error("not used"); },
    touchWorkshopSchedule: async () => { throw new Error("not used"); },
  });
  return { capture, service };
}

test("cancelBooking is a releasing conditional customer transition with one stable history snapshot", async () => {
  let clockReads = 0;
  const { capture, service } = transitionHarness({
    currentDate() {
      clockReads += 1;
      return NOW;
    },
  });
  const result = await service.cancelBooking({
    bookingId: BOOKING_ID,
    actor: customer,
    reason: "  Cannot attend  ",
  });

  assert.equal(clockReads, 1);
  assert.deepEqual(capture.findOne[0], { _id: BOOKING_ID, customer: CUSTOMER_ID });
  assert.deepEqual(capture.updates[0], {
    filter: { _id: BOOKING_ID, status: "requested" },
    update: {
      $set: { status: "cancelled" },
      $push: {
        statusHistory: {
          fromStatus: "requested",
          toStatus: "cancelled",
          changedAt: NOW,
          actor: {
            userId: CUSTOMER_ID,
            username: "booking_customer",
            role: "customer",
          },
          reason: "Cannot attend",
        },
      },
      $unset: { reservedSlotKeys: "" },
    },
    options: { new: true, runValidators: true },
  });
  assert.equal(result.reservedSlotKeys, undefined);
});

test("transitionBooking delegates graph policy centrally and retains capacity without an unset", async () => {
  const allowed = transitionHarness({
    updated: { _id: BOOKING_ID, status: "confirmed" },
  });
  await allowed.service.transitionBooking({
    bookingId: BOOKING_ID,
    actor: admin,
    toStatus: "confirmed",
    now: NOW,
  });
  assert.deepEqual(allowed.capture.findOne[0], { _id: BOOKING_ID });
  assert.deepEqual(Object.keys(allowed.capture.updates[0].update).sort(), ["$push", "$set"]);
  assert.equal(allowed.capture.updates[0].update.$push.statusHistory.reason, null);

  const forbidden = transitionHarness();
  await assert.rejects(
    forbidden.service.transitionBooking({
      bookingId: BOOKING_ID,
      actor: customer,
      toStatus: "confirmed",
      now: NOW,
    }),
    (error) => error.statusCode === 409
      && error.message === "Booking status no longer permits this action",
  );
  assert.equal(forbidden.capture.updates.length, 0);
});

test("transitionBooking populates customer identity after the conditional update", async () => {
  const populatedCustomer = {
    _id: CUSTOMER_ID,
    username: "booking_customer",
    email: "booking_customer@example.com",
  };
  const harness = transitionHarness({
    updated: {
      _id: BOOKING_ID,
      status: "confirmed",
      customer: populatedCustomer,
    },
  });

  const result = await harness.service.transitionBooking({
    bookingId: BOOKING_ID,
    actor: admin,
    toStatus: "confirmed",
    now: NOW,
  });

  assert.deepEqual(harness.capture.updateQuery.populate, ["customer", "username email"]);
  assert.deepEqual(result.customer, populatedCustomer);
});

test("transitionBooking releases rejection and no-show capacity but retains completed capacity", async () => {
  const cases = [
    {
      current: { _id: BOOKING_ID, status: "requested", startsAt: STARTS_AT },
      toStatus: "rejected",
      reason: "Workshop unavailable",
      now: NOW,
      releases: true,
    },
    {
      current: { _id: BOOKING_ID, status: "confirmed", startsAt: NOW },
      toStatus: "no_show",
      now: NOW,
      releases: true,
    },
    {
      current: { _id: BOOKING_ID, status: "in_service", startsAt: STARTS_AT },
      toStatus: "completed",
      now: NOW,
      releases: false,
    },
  ];

  for (const expected of cases) {
    const harness = transitionHarness({
      current: expected.current,
      updated: { ...expected.current, status: expected.toStatus },
    });
    await harness.service.transitionBooking({
      bookingId: BOOKING_ID,
      actor: admin,
      toStatus: expected.toStatus,
      reason: expected.reason,
      now: expected.now,
    });
    assert.equal(
      Object.hasOwn(harness.capture.updates[0].update, "$unset"),
      expected.releases,
    );
  }
});

test("transitionBooking maps invalid, missing, unauthorized, and stale targets exactly", async () => {
  for (const input of [
    { bookingId: "bad", actor: customer },
    { bookingId: BOOKING_ID, actor: { ...customer, _id: "bad" } },
  ]) {
    const harness = transitionHarness();
    await assert.rejects(
      harness.service.transitionBooking({ ...input, toStatus: "cancelled", now: NOW }),
      (error) => error.statusCode === 404 && error.message === "Booking not found",
    );
    assert.equal(harness.capture.findOne.length, 0);
  }

  const missing = transitionHarness({ current: null });
  await assert.rejects(
    missing.service.transitionBooking({ bookingId: BOOKING_ID, actor: customer, toStatus: "cancelled", now: NOW }),
    (error) => error.statusCode === 404 && error.message === "Booking not found",
  );

  const stale = transitionHarness({ updated: null });
  await assert.rejects(
    stale.service.transitionBooking({ bookingId: BOOKING_ID, actor: customer, toStatus: "cancelled", now: NOW }),
    (error) => error.statusCode === 409
      && error.message === "Booking status no longer permits this action",
  );
});

if (process.env.MONGO_URI_TEST) test.describe("live database: booking service transactions", () => {
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
  test.beforeEach(clearTestDb);
  test.after(disconnectTestDb);

  test("creates across bays, rolls back collisions, and reuses capacity after cancellation", async () => {
    const liveCustomer = await User.create({
      username: "live_booking_customer",
      email: "live-booking@example.com",
      mobile: "9876543210",
      address: "1 Workshop Road",
      passwordHash: "not-used-in-this-test",
      role: "customer",
      isEmailVerified: true,
      isActive: true,
    });
    const liveVehicle = await Vehicle.create({
      owner: liveCustomer._id,
      registrationNumber: "KA01AB1234",
      make: "Tata",
      model: "Nexon",
      year: 2022,
      fuelType: "petrol",
      status: "active",
      activeSlot: 1,
    });
    const liveService = await Service.create({
      name: "Periodic Maintenance",
      category: "maintenance",
      description: "Complete periodic maintenance service.",
      durationMinutes: 90,
      isActive: true,
    });
    const liveSchedule = await ensureDefaultWorkshopSchedule();
    const sourceTimestamps = {
      vehicle: liveVehicle.updatedAt.getTime(),
      service: liveService.updatedAt.getTime(),
      schedule: liveSchedule.updatedAt.getTime(),
    };

    const first = await createBooking({
      customer: liveCustomer,
      vehicleId: liveVehicle._id,
      serviceId: liveService._id,
      startsAt: STARTS_AT,
      notes: "Battery check",
      now: NOW,
    });
    const second = await createBooking({
      customer: liveCustomer,
      vehicleId: liveVehicle._id,
      serviceId: liveService._id,
      startsAt: STARTS_AT,
      now: NOW,
    });

    assert.equal(first.bayNumber, 1);
    assert.equal(second.bayNumber, 2);
    assert.equal(first.reservedSlotKeys, undefined);
    const firstStored = await Booking.findById(first.id).select("+reservedSlotKeys").lean();
    assert.equal(firstStored.reservedSlotKeys.length, 3);

    await cancelBooking({
      bookingId: first.id,
      actor: liveCustomer,
      reason: "Cannot attend",
      now: NOW,
    });
    const cancelled = await Booking.findById(first.id).select("+reservedSlotKeys").lean();
    assert.equal(cancelled.status, "cancelled");
    assert.equal(cancelled.reservedSlotKeys, undefined);

    const replacement = await createBooking({
      customer: liveCustomer,
      vehicleId: liveVehicle._id,
      serviceId: liveService._id,
      startsAt: STARTS_AT,
      now: NOW,
    });
    assert.equal(replacement.bayNumber, 1);

    const [vehicleAfter, serviceAfter, scheduleAfter] = await Promise.all([
      Vehicle.findById(liveVehicle._id).select("+bookingGuardVersion"),
      Service.findById(liveService._id).select("+bookingGuardVersion"),
      WorkshopSchedule.findById(liveSchedule._id).select("+bookingGuardVersion"),
    ]);
    assert.equal(vehicleAfter.bookingGuardVersion, 3);
    assert.equal(serviceAfter.bookingGuardVersion, 3);
    assert.equal(scheduleAfter.bookingGuardVersion, 3);
    assert.equal(vehicleAfter.updatedAt.getTime(), sourceTimestamps.vehicle);
    assert.equal(serviceAfter.updatedAt.getTime(), sourceTimestamps.service);
    assert.equal(scheduleAfter.updatedAt.getTime(), sourceTimestamps.schedule);
  });
});
