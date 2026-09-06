const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const Booking = require("../../models/Booking");
const { BOOKING_STATUSES } = require("../../config/bookingPolicy");
const {
  toSafeCustomerBooking,
  toSafeAdminBooking,
} = require("../../utils/bookingResponse");

function bookingFixture(overrides = {}) {
  const customerId = new mongoose.Types.ObjectId();
  const vehicleId = new mongoose.Types.ObjectId();
  const serviceId = new mongoose.Types.ObjectId();
  const adminId = new mongoose.Types.ObjectId();
  const createdAt = new Date("2026-08-29T12:00:00.000Z");
  const updatedAt = new Date("2026-08-29T12:05:00.000Z");

  return {
    _id: new mongoose.Types.ObjectId(),
    customer: {
      _id: customerId,
      username: "customer_one",
      email: "customer@example.com",
      mobile: "9876543210",
      address: "Chennai",
      passwordHash: "never-expose",
    },
    vehicle: { _id: vehicleId, owner: customerId, activeSlot: 1 },
    vehicleSnapshot: {
      registrationNumber: "TN01AB1234",
      make: "Tata",
      model: "Nexon",
      year: 2025,
      fuelType: "electric",
    },
    service: serviceId,
    serviceSnapshot: {
      name: "Periodic Maintenance",
      slug: "periodic-maintenance",
      category: "maintenance",
      durationMinutes: 90,
    },
    startsAt: new Date("2026-09-01T03:30:00.000Z"),
    endsAt: new Date("2026-09-01T05:00:00.000Z"),
    localDate: "2026-09-01",
    timeZone: "Asia/Kolkata",
    bayNumber: 2,
    reservedSlotKeys: ["2026-09-01T03:30:00.000Z|bay:2"],
    status: "confirmed",
    notes: "Inspect battery",
    statusHistory: [
      {
        fromStatus: null,
        toStatus: "requested",
        changedAt: createdAt,
        actor: {
          userId: customerId,
          username: "customer_one",
          role: "customer",
        },
        reason: null,
      },
      {
        fromStatus: "requested",
        toStatus: "confirmed",
        changedAt: updatedAt,
        actor: {
          userId: adminId,
          username: "admin_one",
          role: "admin",
        },
        reason: "Capacity confirmed",
      },
    ],
    bookingGuardVersion: 4,
    __v: 9,
    createdAt,
    updatedAt,
    ...overrides,
  };
}

test("customer projection returns exactly the approved snapshot-backed shape", () => {
  const fixture = bookingFixture();
  const safe = toSafeCustomerBooking(fixture);

  assert.deepEqual(Object.keys(safe), [
    "id",
    "vehicle",
    "service",
    "startsAt",
    "endsAt",
    "localDate",
    "timeZone",
    "status",
    "notes",
    "statusHistory",
    "createdAt",
    "updatedAt",
  ]);
  assert.deepEqual(safe.vehicle, {
    id: fixture.vehicle._id.toString(),
    registrationNumber: "TN01AB1234",
    make: "Tata",
    model: "Nexon",
    year: 2025,
    fuelType: "electric",
  });
  assert.deepEqual(safe.service, {
    name: "Periodic Maintenance",
    slug: "periodic-maintenance",
    category: "maintenance",
    durationMinutes: 90,
  });
  assert.deepEqual(safe.statusHistory[0], {
    fromStatus: null,
    toStatus: "requested",
    changedAt: fixture.statusHistory[0].changedAt,
    actorLabel: "Customer",
    reason: null,
  });
  assert.deepEqual(safe.statusHistory[1], {
    fromStatus: "requested",
    toStatus: "confirmed",
    changedAt: fixture.statusHistory[1].changedAt,
    actorLabel: "Administrator",
    reason: "Capacity confirmed",
  });
});

test("customer projection omits private, raw-reference, bay, reservation, and guard fields", () => {
  const safe = toSafeCustomerBooking(bookingFixture());
  const serialized = JSON.stringify(safe);

  for (const field of [
    "customer",
    "bayNumber",
    "reservedSlotKeys",
    "bookingGuardVersion",
    "vehicleSnapshot",
    "serviceSnapshot",
    "_id",
    "__v",
    "userId",
    "username",
    "admin_one",
    "customer@example.com",
  ]) {
    assert.equal(serialized.includes(field), false, field);
  }
});

test("customer projection supports Mongoose documents and ObjectId or string references", () => {
  const plain = bookingFixture();
  const {
    bookingGuardVersion: _bookingGuardVersion,
    __v: _version,
    ...documentFields
  } = plain;
  const document = new Booking({
    ...documentFields,
    customer: plain.customer._id,
    vehicle: plain.vehicle._id,
  });
  const fromDocument = toSafeCustomerBooking(document);
  const fromStrings = toSafeCustomerBooking(bookingFixture({
    _id: "booking-string",
    vehicle: "vehicle-string",
    service: "service-string",
  }));

  assert.equal(fromDocument.id, document.id);
  assert.equal(fromDocument.vehicle.id, plain.vehicle._id.toString());
  assert.equal(fromStrings.id, "booking-string");
  assert.equal(fromStrings.vehicle.id, "vehicle-string");
});

test("customer projection preserves every status, always includes history reason, and omits absent notes", () => {
  for (const status of BOOKING_STATUSES) {
    const safe = toSafeCustomerBooking(bookingFixture({
      status,
      notes: undefined,
      statusHistory: [{
        fromStatus: null,
        toStatus: status,
        changedAt: new Date("2026-08-29T12:00:00.000Z"),
        actor: { userId: "customer-1", username: "customer_one", role: "customer" },
      }],
    }));

    assert.equal(safe.status, status);
    assert.equal("notes" in safe, false);
    assert.equal(Object.hasOwn(safe.statusHistory[0], "reason"), true);
    assert.equal(safe.statusHistory[0].reason, null);
  }
});

test("admin projection adds only safe customer, bay, and actor snapshot fields", () => {
  const fixture = bookingFixture();
  const safe = toSafeAdminBooking(fixture);

  assert.deepEqual(safe.customer, {
    id: fixture.customer._id.toString(),
    username: "customer_one",
    email: "customer@example.com",
  });
  assert.equal(safe.bayNumber, 2);
  assert.deepEqual(safe.statusHistory[1].actor, {
    id: fixture.statusHistory[1].actor.userId.toString(),
    username: "admin_one",
    role: "admin",
  });
  assert.equal("actorLabel" in safe.statusHistory[1], false);

  const serialized = JSON.stringify(safe);
  for (const field of [
    "reservedSlotKeys",
    "bookingGuardVersion",
    "vehicleSnapshot",
    "serviceSnapshot",
    "passwordHash",
    "mobile",
    "address",
    "_id",
    "__v",
  ]) {
    assert.equal(serialized.includes(field), false, field);
  }
});

test("serializers create independent nested projections without mutating source snapshots", () => {
  const fixture = bookingFixture();
  const originalVehicleMake = fixture.vehicleSnapshot.make;
  const originalReason = fixture.statusHistory[1].reason;
  const originalCustomer = fixture.customer.username;
  const customerSafe = toSafeCustomerBooking(fixture);
  const adminSafe = toSafeAdminBooking(fixture);

  customerSafe.vehicle.make = "Changed";
  customerSafe.statusHistory[1].reason = "Changed";
  adminSafe.customer.username = "changed_admin_view";
  adminSafe.statusHistory[1].actor.username = "changed_actor";

  assert.equal(fixture.vehicleSnapshot.make, originalVehicleMake);
  assert.equal(fixture.statusHistory[1].reason, originalReason);
  assert.equal(fixture.customer.username, originalCustomer);
  assert.equal(fixture.statusHistory[1].actor.username, "admin_one");
});
