const test = require("node:test");
const assert = require("node:assert/strict");
const { describe } = test;

const Service = require("../../models/Service");
const {
  connectTestDb,
  clearTestDb,
  disconnectTestDb,
} = require("../helpers/testDb");
const {
  createService,
  touchActiveService,
  updateService,
} = require("../../services/serviceCatalogService");

const categories = [
  "maintenance",
  "repair",
  "inspection",
  "cleaning",
  "tyre",
  "electrical",
  "other",
];

function serviceInput(overrides = {}) {
  return {
    name: "Periodic Maintenance",
    category: "maintenance",
    description: "A complete periodic maintenance service.",
    durationMinutes: 90,
    ...overrides,
  };
}

function isValidationError(error) {
  return error?.name === "ValidationError";
}

function indexWithKey(indexes, expectedKey) {
  return indexes.filter(
    (index) => JSON.stringify(index.key) === JSON.stringify(expectedKey),
  );
}

test("pure schema: derives normalized service identity and internal defaults", async () => {
  const service = new Service(serviceInput({ name: "  Periodic\n Maintenance  " }));

  await service.validate();

  assert.equal(service.name, "Periodic Maintenance");
  assert.equal(service.slug, "periodic-maintenance");
  assert.equal(service.nameKey, "periodic maintenance");
  assert.equal(service.isActive, true);
  assert.equal(service.bookingGuardVersion, 0);
});

test("pure schema: enforces service name and description trimmed boundaries", async () => {
  for (const overrides of [
    { name: "A" },
    { name: "N".repeat(81) },
    { description: "short" },
    { description: "D".repeat(501) },
  ]) {
    await assert.rejects(new Service(serviceInput(overrides)).validate(), isValidationError);
  }

  const service = new Service(serviceInput({
    name: " AB ",
    description: ` ${"D".repeat(10)} `,
  }));
  await service.validate();
  assert.equal(service.name, "AB");
  assert.equal(service.description, "D".repeat(10));
});

test("pure schema: accepts only approved categories", async () => {
  for (const category of categories) {
    await new Service(serviceInput({ category })).validate();
  }
  await assert.rejects(
    new Service(serviceInput({ category: "bodywork" })).validate(),
    isValidationError,
  );
});

test("pure schema: duration is an integer whole-slot value from 30 through 240", async () => {
  for (const durationMinutes of [29, 45, 241, 60.5, [60], { value: 60 }]) {
    await assert.rejects(
      new Service(serviceInput({ durationMinutes })).validate(),
      isValidationError,
    );
  }
  for (const durationMinutes of [30, 60, 240]) {
    await new Service(serviceInput({ durationMinutes })).validate();
  }
});

test("pure schema: server identity and guard paths are protected", () => {
  assert.equal(Service.schema.path("slug").options.immutable, true);
  assert.equal(Service.schema.path("nameKey").options.select, false);
  assert.equal(Service.schema.path("bookingGuardVersion").options.select, false);
  assert.equal(Service.schema.path("bookingGuardVersion").options.min, 0);
});

test("pure schema: declares exactly the three required application indexes", () => {
  assert.deepEqual(Service.schema.indexes(), [
    [{ slug: 1 }, { unique: true }],
    [{ nameKey: 1 }, { unique: true }],
    [{ isActive: 1, name: 1 }, {}],
  ]);
});

if (process.env.MONGO_URI_TEST) describe("live database: Service persistence", () => {
  test.before(async () => {
    await connectTestDb();
    await Service.init();
  });
  test.beforeEach(clearTestDb);
  test.after(disconnectTestDb);

  test("stores normalized fields while default queries exclude internal state", async () => {
    const created = await Service.create(serviceInput({ name: "  Oil  Change " }));
    const stored = await Service.findById(created._id).lean();

    assert.equal(stored.name, "Oil Change");
    assert.equal(stored.slug, "oil-change");
    assert.equal(Object.hasOwn(stored, "nameKey"), false);
    assert.equal(Object.hasOwn(stored, "bookingGuardVersion"), false);
  });

  test("keeps slug immutable when the display name changes", async () => {
    const created = await Service.create(serviceInput());
    created.name = "Premium Maintenance";
    created.slug = "premium-maintenance";
    await created.save();

    const stored = await Service.findById(created._id).select("+nameKey");
    assert.equal(stored.name, "Premium Maintenance");
    assert.equal(stored.slug, "periodic-maintenance");
    assert.equal(stored.nameKey, "premium maintenance");
  });

  test("unique indexes reject normalized-name and slug collisions", async () => {
    await Service.create(serviceInput());
    await assert.rejects(
      Service.create(serviceInput({ name: " periodic   MAINTENANCE " })),
      (error) => error?.code === 11000,
    );
    await assert.rejects(
      Service.create(serviceInput({ name: "Periodic--Maintenance" })),
      (error) => error?.code === 11000,
    );
  });

  test("normal edits increment the guard and timestamp while guard-only touches do not", async () => {
    const created = await createService(serviceInput());
    const oldUpdatedAt = new Date("2020-01-01T00:00:00.000Z");
    await Service.collection.updateOne(
      { _id: created._id },
      { $set: { updatedAt: oldUpdatedAt } },
    );

    const touched = await touchActiveService({ serviceId: created._id });
    assert.ok(touched);
    let stored = await Service.findById(created._id).select("+bookingGuardVersion");
    assert.equal(stored.bookingGuardVersion, 1);
    assert.equal(stored.updatedAt.toISOString(), oldUpdatedAt.toISOString());

    const updated = await updateService({
      serviceId: created._id,
      patch: { description: "A newly expanded periodic maintenance service." },
    });
    assert.ok(updated);
    stored = await Service.findById(created._id).select("+bookingGuardVersion");
    assert.equal(stored.bookingGuardVersion, 2);
    assert.ok(stored.updatedAt > oldUpdatedAt);
  });

  test("contains exactly the three required live application indexes", async () => {
    const indexes = await Service.collection.indexes();
    const applicationIndexes = indexes.filter((index) => index.name !== "_id_");

    assert.equal(applicationIndexes.length, 3);
    assert.equal(indexWithKey(indexes, { slug: 1 }).length, 1);
    assert.equal(indexWithKey(indexes, { slug: 1 })[0].unique, true);
    assert.equal(indexWithKey(indexes, { nameKey: 1 }).length, 1);
    assert.equal(indexWithKey(indexes, { nameKey: 1 })[0].unique, true);
    assert.equal(indexWithKey(indexes, { isActive: 1, name: 1 }).length, 1);
  });
});
