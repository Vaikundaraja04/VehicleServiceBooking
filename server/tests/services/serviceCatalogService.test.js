const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createServiceCatalogService,
} = require("../../services/serviceCatalogService");

function queryResult(value, capture = {}) {
  return {
    sort(valueToCapture) {
      capture.sort = valueToCapture;
      return this;
    },
    skip(valueToCapture) {
      capture.skip = valueToCapture;
      return this;
    },
    limit(valueToCapture) {
      capture.limit = valueToCapture;
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve(value).then(resolve, reject);
    },
  };
}

function validInput(overrides = {}) {
  return {
    name: " Periodic   Maintenance ",
    category: "maintenance",
    description: "A complete periodic maintenance service.",
    durationMinutes: 90,
    ...overrides,
  };
}

test("createService derives identity and ignores server-owned input", async () => {
  let inserted;
  const Service = {
    async create(value) {
      inserted = value;
      return { _id: "service-1", ...value };
    },
  };
  const service = createServiceCatalogService({ Service });

  const created = await service.createService(validInput({
    slug: "attacker-slug",
    nameKey: "attacker-key",
    bookingGuardVersion: 99,
    isActive: false,
    unknown: true,
  }));

  assert.deepEqual(inserted, {
    name: "Periodic Maintenance",
    slug: "periodic-maintenance",
    nameKey: "periodic maintenance",
    category: "maintenance",
    description: "A complete periodic maintenance service.",
    durationMinutes: 90,
  });
  assert.equal(created._id, "service-1");
});

test("createService rejects a normalized name with an empty derived ASCII slug before persistence", async () => {
  for (const name of ["---", "é 😀"]) {
    let createCalls = 0;
    const Service = {
      async create() {
        createCalls += 1;
        return { _id: "unexpected" };
      },
    };
    const service = createServiceCatalogService({ Service });

    await assert.rejects(
      service.createService(validInput({ name })),
      (error) => error instanceof Error
        && error.statusCode === 400
        && error.message === "Validation failed"
        && JSON.stringify(error.errors) === JSON.stringify([{
          field: "name",
          message: "Service name must contain at least one ASCII letter or number",
        }]),
    );
    assert.equal(createCalls, 0, name);
  }
});

test("createService maps a slug or normalized-name collision to the exact conflict", async () => {
  for (const keyPattern of [{ slug: 1 }, { nameKey: 1 }]) {
    const Service = {
      async create() {
        throw Object.assign(new Error("duplicate"), { code: 11000, keyPattern });
      },
    };
    const service = createServiceCatalogService({ Service });
    await assert.rejects(service.createService(validInput()), (error) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.message, "A service with this name already exists");
      return true;
    });
  }
});

test("updateService normalizes a renamed service without rewriting its immutable slug", async () => {
  const capture = {};
  const Service = {
    findOneAndUpdate(filter, update, options) {
      Object.assign(capture, { filter, update, options });
      return Promise.resolve({ _id: "service-1" });
    },
  };
  const service = createServiceCatalogService({
    Service,
    isValidObjectId: (value) => value === "service-1",
  });

  await service.updateService({
    serviceId: "service-1",
    patch: {
      name: " Premium   Maintenance ",
      category: "repair",
      isActive: false,
      slug: "changed",
      bookingGuardVersion: 100,
    },
  });

  assert.deepEqual(capture.filter, { _id: "service-1" });
  assert.deepEqual(capture.update, {
    $set: {
      name: "Premium Maintenance",
      nameKey: "premium maintenance",
      category: "repair",
      isActive: false,
    },
    $inc: { bookingGuardVersion: 1 },
  });
  assert.deepEqual(capture.options, { new: true, runValidators: true });
});

test("updateService rejects an empty derived slug before update and preserves immutable identity", async () => {
  let updateCalls = 0;
  const Service = {
    findOneAndUpdate() {
      updateCalls += 1;
      return Promise.resolve({ _id: "unexpected" });
    },
  };
  const service = createServiceCatalogService({
    Service,
    isValidObjectId: (value) => value === "service-1",
  });

  await assert.rejects(
    service.updateService({
      serviceId: "service-1",
      patch: { name: " 😀 -- " },
    }),
    (error) => error?.statusCode === 400
      && error.message === "Validation failed"
      && error.errors?.[0]?.field === "name",
  );
  assert.equal(updateCalls, 0);
});

test("updateService is race-safe for duplicate rename and rejects malformed ids before Mongoose", async () => {
  let calls = 0;
  const duplicate = Object.assign(new Error("duplicate"), {
    code: 11000,
    keyValue: { nameKey: "periodic maintenance" },
  });
  const Service = {
    findOneAndUpdate() {
      calls += 1;
      return Promise.reject(duplicate);
    },
  };
  const service = createServiceCatalogService({
    Service,
    isValidObjectId: (value) => value === "valid",
  });

  assert.equal(await service.updateService({ serviceId: "bad", patch: { name: "Name" } }), null);
  await assert.rejects(
    service.updateService({ serviceId: "valid", patch: { name: "Name" } }),
    (error) => error.statusCode === 409
      && error.message === "A service with this name already exists",
  );
  assert.equal(calls, 1);
});

test("touchActiveService increments only an active service guard without timestamps", async () => {
  const capture = {};
  const Service = {
    findOneAndUpdate(filter, update, options) {
      Object.assign(capture, { filter, update, options });
      return Promise.resolve({ _id: "service-1" });
    },
  };
  const service = createServiceCatalogService({ Service });
  const session = { id: "session-1" };

  await service.touchActiveService({ serviceId: "service-1", session });

  assert.deepEqual(capture, {
    filter: { _id: "service-1", isActive: true },
    update: { $inc: { bookingGuardVersion: 1 } },
    options: { new: true, session, timestamps: false },
  });
});

test("active reads use exact filters and stable name ordering", async () => {
  const capture = {};
  const expected = [{ _id: "service-1" }];
  const Service = {
    findOne(filter) {
      capture.one = filter;
      return Promise.resolve(expected[0]);
    },
    find(filter) {
      capture.many = filter;
      return queryResult(expected, capture);
    },
  };
  const service = createServiceCatalogService({
    Service,
    isValidObjectId: (value) => value === "service-1",
  });

  assert.equal(await service.getActiveService("bad"), null);
  assert.equal(await service.getActiveService("service-1"), expected[0]);
  assert.equal(await service.listActiveServices(), expected);
  assert.deepEqual(capture.one, { _id: "service-1", isActive: true });
  assert.deepEqual(capture.many, { isActive: true });
  assert.deepEqual(capture.sort, { name: 1, _id: 1 });
});

test("adminListServices escapes search, filters active state, and paginates", async () => {
  const capture = {};
  const Service = {
    countDocuments(filter) {
      capture.countFilter = filter;
      return Promise.resolve(21);
    },
    find(filter) {
      capture.findFilter = filter;
      return queryResult([{ _id: "service-1" }], capture);
    },
  };
  const service = createServiceCatalogService({ Service });

  const result = await service.adminListServices({
    page: 2,
    limit: 10,
    isActive: false,
    search: "oil.*(change)",
  });

  assert.deepEqual(capture.findFilter, capture.countFilter);
  assert.equal(capture.findFilter.isActive, false);
  assert.equal(capture.findFilter.name.$regex.source, "oil\\.\\*\\(change\\)");
  assert.equal(capture.findFilter.name.$regex.flags, "i");
  assert.deepEqual(capture.sort, { name: 1, _id: 1 });
  assert.equal(capture.skip, 10);
  assert.equal(capture.limit, 10);
  assert.deepEqual(result, {
    services: [{ _id: "service-1" }],
    pagination: { page: 2, limit: 10, totalItems: 21, totalPages: 3 },
  });
});
