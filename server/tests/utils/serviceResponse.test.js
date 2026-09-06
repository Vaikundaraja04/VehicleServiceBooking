const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const Service = require("../../models/Service");
const {
  toSafeAdminService,
  toSafeService,
} = require("../../utils/serviceResponse");

function serviceFields(overrides = {}) {
  return {
    name: "Periodic Maintenance",
    slug: "periodic-maintenance",
    nameKey: "periodic maintenance",
    category: "maintenance",
    description: "Scheduled inspection and preventive maintenance.",
    durationMinutes: 90,
    isActive: true,
    bookingGuardVersion: 7,
    __v: 3,
    ...overrides,
  };
}

test("service projection returns exactly the customer catalogue fields from a Mongoose document", () => {
  const id = new mongoose.Types.ObjectId();
  const service = new Service({ _id: id, ...serviceFields() });

  const safe = toSafeService(service);

  assert.deepEqual(safe, {
    id: id.toString(),
    name: "Periodic Maintenance",
    slug: "periodic-maintenance",
    category: "maintenance",
    description: "Scheduled inspection and preventive maintenance.",
    durationMinutes: 90,
  });
  assert.deepEqual(Object.keys(safe), [
    "id",
    "name",
    "slug",
    "category",
    "description",
    "durationMinutes",
  ]);
});

test("service projection normalizes ObjectId and string identifier representations", () => {
  const objectId = new mongoose.Types.ObjectId();
  const fromObjectId = toSafeService({ _id: objectId, ...serviceFields() });
  const fromString = toSafeService({ id: "service-string", ...serviceFields() });
  const fromIdObjectId = toSafeService({ id: objectId, ...serviceFields() });

  assert.equal(fromObjectId.id, objectId.toString());
  assert.equal(fromString.id, "service-string");
  assert.equal(fromIdObjectId.id, objectId.toString());
});

test("service projection omits every internal field and does not mutate the source", () => {
  const source = { _id: "service-1", ...serviceFields() };
  const before = { ...source };
  const safe = toSafeService(source);

  assert.equal("_id" in safe, false);
  assert.equal("__v" in safe, false);
  assert.equal("nameKey" in safe, false);
  assert.equal("isActive" in safe, false);
  assert.equal("bookingGuardVersion" in safe, false);
  assert.deepEqual(source, before);
});

test("admin service projection adds only active state and keeps customer projection unchanged", () => {
  const id = new mongoose.Types.ObjectId();
  const source = {
    _id: id,
    ...serviceFields({
      isActive: false,
      createdAt: new Date("2026-08-29T00:00:00.000Z"),
      updatedAt: new Date("2026-08-29T01:00:00.000Z"),
    }),
  };
  const before = { ...source };

  const customerSafe = toSafeService(source);
  const adminSafe = toSafeAdminService(source);

  assert.deepEqual(Object.keys(customerSafe), [
    "id",
    "name",
    "slug",
    "category",
    "description",
    "durationMinutes",
  ]);
  assert.deepEqual(adminSafe, {
    id: id.toString(),
    name: "Periodic Maintenance",
    slug: "periodic-maintenance",
    category: "maintenance",
    description: "Scheduled inspection and preventive maintenance.",
    durationMinutes: 90,
    isActive: false,
  });
  for (const field of [
    "_id",
    "__v",
    "nameKey",
    "bookingGuardVersion",
    "createdAt",
    "updatedAt",
  ]) {
    assert.equal(field in adminSafe, false, field);
  }
  assert.deepEqual(source, before);
});
