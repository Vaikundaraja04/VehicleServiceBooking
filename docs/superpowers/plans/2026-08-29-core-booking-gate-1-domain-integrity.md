# Core Booking Gate 1: Domain Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the transaction-safe scheduling domain—replica-set test support, schedule and service foundation, availability, booking reservation invariants, state transitions, and race evidence—without adding HTTP routes, controllers, validators, serializers, or client UI.

**Architecture:** Mongoose models enforce stored-document shape, indexes, immutability, and booking update restrictions. Pure Luxon-based policy functions calculate workshop-local availability and state legality; command services own all database reads, transactions, guard increments, conflict mapping, and lifecycle writes. MongoDB’s named partial unique multikey reservation index is the final overlap arbiter, while transactions serialize booking creation against vehicle, service, and schedule mutations.

**Tech Stack:** Node.js CommonJS, Express 5, Mongoose 9 / MongoDB replica set, Luxon, Node `node:test`, `assert/strict`, Supertest.

**Spec:** `docs/superpowers/specs/2026-08-29-core-booking-design.md`

## Global Constraints

- Preserve all existing authentication and vehicle behavior, exact response wording, cookie/JWT security, origin guard, validators, serializers, and role guards.
- This gate adds no public booking or service HTTP endpoint and no client code; Gate 2 wires the tested domain to customer APIs.
- Workshop timezone is exactly `Asia/Kolkata`; persist instants as UTC `Date` values; use Luxon for all local-date math.
- Grid is exactly 30 minutes, service duration is an integer 30–240 inclusive divisible by 30, booking horizon is exactly today through today + 29 workshop-local dates, and lead time is exactly 60 minutes.
- MongoDB transactions are mandatory: tests and development must use a single-node replica set named `rs0`; never implement a standalone compensation workflow.
- The development replica member advertises `mongo:27017`, so the application must run inside the Compose network once Gate 4 adds the `api` service. Do not document a host-run `localhost` API against that member; before Gate 4, Compose proves the database contract and host-side automated tests use the isolated `MongoMemoryReplSet` wrapper.
- Do not use `countDocuments()` as a capacity arbiter and do not trust client-derived `endsAt`, bay number, local date, duration, snapshots, or reservation keys.
- Booking creation tries bay numbers 1–5 in ascending order, with a fresh transaction for each candidate after a reservation duplicate.
- The reservation index is named `uniq_booking_reserved_slot`; only that duplicate maps to `409 { "message": "That time is no longer available" }` after every current bay collides.
- `reservedSlotKeys` uses `default: undefined`; capacity-retaining statuses require canonical non-empty keys, while `cancelled`, `rejected`, and `no_show` must omit the field via `$unset`.
- Existing server test command remains `node --require ./tests/test-env.js --test --test-concurrency=1`; race tests create concurrency inside one test using simultaneous promises.
- All scheduled-write guard touches set `{ timestamps: false }`, so booking creation does not change Vehicle, Service, or WorkshopSchedule `updatedAt`.

---

## File map

| File | Gate 1 responsibility |
|---|---|
| `docker-compose.yml` | Starts the `mongo` and idempotent `mongo-init` replica-set services for development. |
| `docker/mongo-init.sh` | Initializes `rs0` with member `mongo:27017` and fails if no primary appears. |
| `server/scripts/run-tests-with-replset.js` | Starts an isolated `MongoMemoryReplSet` named `rs0`, runs Node tests, and always stops it. |
| `server/package.json` | Adds Luxon and deterministic `seed:booking` / focused test scripts. |
| `server/tests/test-env.js` | Uses the guarded `rs0` test URI. |
| `server/tests/helpers/testDb.js` | Refuses non-test databases and non-replica deployments. |
| `server/config/bookingPolicy.js` | Single source of grid, horizon, timezone, duration, and status constants. |
| `server/utils/serviceNormalization.js` | Single source of service name key and immutable slug normalization. |
| `server/utils/bookingReservation.js` | Canonical slot-key creation and reservation invariant checks. |
| `server/utils/bookingDuplicateKey.js` | Named reservation-index duplicate detection; all other duplicate errors pass through. |
| `server/models/Service.js` | Service schema, indexes, rename normalization, booking guard. |
| `server/models/WorkshopSchedule.js` | Singleton schedule schema and full-document schedule invariant. |
| `server/models/Booking.js` | Booking schema, indexes, immutable snapshots, update firewall. |
| `server/services/availabilityService.js` | Pure schedule interval, horizon, lead-time, and availability calculations. |
| `server/services/bookingStateMachine.js` | Only source of transition, actor, timing, and reason rules. |
| `server/services/serviceCatalogService.js` | Domain service catalog reads/writes and active-service guard touch. |
| `server/services/workshopScheduleService.js` | Startup singleton initialization and transactional schedule replacement. |
| `server/services/bookingService.js` | Transactional creation, reservation selection, booking reads, and transitions. |
| `server/scripts/seed-booking-foundation.js` | Explicit idempotent schedule/service seed command. |
| `server/models/Vehicle.js` | Internal booking guard version. |
| `server/services/vehicleService.js` | Business vehicle edits increment booking guard. |
| `server/index.js` | Initializes new model indexes and default schedule before listening. |

## Task 1: Replica-set development and test foundation

**Files:**
- Create: `docker-compose.yml`
- Create: `docker/mongo-init.sh`
- Create: `server/scripts/run-tests-with-replset.js`
- Modify: `server/package.json`
- Modify: `server/package-lock.json`
- Modify: `server/tests/test-env.js`
- Modify: `server/tests/helpers/testDb.js`
- Modify: `server/tests/helpers/testDb.test.js`

**Interfaces:**
- Produces `validateTestDatabaseUri(uri)`, `connectTestDb(): Promise<void>`, `clearTestDb(): Promise<void>`, `disconnectTestDb(): Promise<void>`, and injectable `assertReplicaSet({ admin } = {}): Promise<void>`.
- Every database-backed Gate 1 test imports these helpers.

- [ ] **Step 1: Write failing URI-guard and replica-capability tests.**

```js
assert.doesNotThrow(() => validateTestDatabaseUri("mongodb://127.0.0.1:41001/vehicle_service_booking_test?replicaSet=rs0"));
assert.throws(() => validateTestDatabaseUri("mongodb://127.0.0.1:27017/vehicle_service_booking"), /unsafe test database/i);
assert.throws(() => validateTestDatabaseUri("mongodb://127.0.0.1:27017/vehicle_service_booking_test"), /replicaSet=rs0/i);
await assert.doesNotReject(assertReplicaSet({ admin: { command: async () => ({ setName: "rs0", isWritablePrimary: true }) } }));
await assert.rejects(assertReplicaSet({ admin: { command: async () => ({}) } }), /writable MongoDB replica set rs0/i);
```

- [ ] **Step 2: Run the helper test and verify the expected initial failure.**

Run: `cd server && npm test -- tests/helpers/testDb.test.js`

Expected: FAIL because the safe URI parser, injectable replica assertion, and replica-set runner do not exist.

- [ ] **Step 3: Add the exact development Compose contract.**

```yaml
services:
  mongo:
    image: mongo:8
    command: ["mongod", "--replSet", "rs0", "--bind_ip_all"]
    ports:
      - "27017:27017"
    healthcheck:
      test: ["CMD-SHELL", "mongosh --quiet --eval 'db.adminCommand({ ping: 1 }).ok' | grep 1"]
      interval: 5s
      timeout: 5s
      retries: 30
  mongo-init:
    image: mongo:8
    depends_on:
      mongo:
        condition: service_healthy
    volumes:
      - ./docker/mongo-init.sh:/mongo-init.sh:ro
    entrypoint: ["sh", "/mongo-init.sh"]
```

- [ ] **Step 4: Implement fail-closed idempotent Compose initialization.**

```sh
#!/bin/sh
set -eu
uri='mongodb://mongo:27017/admin?directConnection=true'
mongosh --quiet "$uri" --eval '
try { rs.status() } catch (error) {
  if (error.codeName === "NotYetInitialized") {
    rs.initiate({_id:"rs0",members:[{_id:0,host:"mongo:27017"}]})
  } else { throw error }
}'
attempt=0
while [ "$attempt" -lt 60 ]; do
  if mongosh --quiet "$uri" --eval 'quit(db.hello().isWritablePrimary && db.hello().setName === "rs0" ? 0 : 1)'; then exit 0; fi
  attempt=$((attempt + 1)); sleep 1
done
echo 'MongoDB replica set rs0 did not become primary' >&2
exit 1
```

- [ ] **Step 5: Implement the isolated in-process test wrapper.**

```js
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const { spawn } = require("node:child_process");

async function main() {
  const replSet = await MongoMemoryReplSet.create({ replSet: { name: "rs0", count: 1, storageEngine: "wiredTiger" } });
  const uri = replSet.getUri("vehicle_service_booking_test");
  try {
    const child = spawn(process.execPath, ["--require", "./tests/test-env.js", "--test", "--test-concurrency=1", ...process.argv.slice(2)], {
      cwd: require("node:path").join(__dirname, ".."), stdio: "inherit",
      env: { ...process.env, MONGO_URI_TEST: uri, MONGO_URI: uri, TEST_DATABASE_URI: uri },
    });
    process.exitCode = await new Promise((resolve) => child.once("close", (code) => resolve(code ?? 1)));
  } finally { await replSet.stop(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
```

The wrapper must forward SIGINT/SIGTERM to the child, stop the replica set in `finally`, and preserve a nonzero child/download/startup exit. The first run may download a compatible MongoDB binary; CI caches that binary. When this executor cannot reach the binary host, record the infrastructure blocker and run the same tests in Docker/CI rather than weakening them to standalone MongoDB.

- [ ] **Step 6: Implement the dynamic-port safety guard and live replica assertion.**

```js
function validateTestDatabaseUri(uri) {
  const parsed = new URL(uri);
  if (parsed.pathname !== "/vehicle_service_booking_test") throw new Error("Refusing unsafe test database");
  if (parsed.searchParams.get("replicaSet") !== "rs0") throw new Error("Test URI must use replicaSet=rs0");
}
async function assertReplicaSet({ admin = mongoose.connection.db.admin() } = {}) {
  const hello = await admin.command({ hello: 1 });
  if (hello.setName !== "rs0" || !hello.isWritablePrimary) throw new Error("Booking tests require writable MongoDB replica set rs0");
}
```

Require `MONGO_URI_TEST === TEST_DATABASE_URI`, validate its database/replica name, then connect and call `assertReplicaSet`. `clearTestDb` independently checks `mongoose.connection.name === "vehicle_service_booking_test"` before deletion.

- [ ] **Step 7: Add dependencies and scripts.**

```json
{
  "scripts": {
    "test": "node scripts/run-tests-with-replset.js",
    "test:models": "npm test -- tests/models",
    "test:services": "npm test -- tests/services",
    "seed:booking": "node scripts/seed-booking-foundation.js"
  },
  "dependencies": {
    "luxon": "^3.7.2"
  },
  "devDependencies": {
    "mongodb-memory-server": "^10.2.0",
    "supertest": "^7.2.2"
  }
}
```

- [ ] **Step 8: Run the self-contained focused test and verify it passes.**

Run: `cd server && npm test -- tests/helpers/testDb.test.js`

Expected: PASS against an isolated writable `rs0`; test cleanup still refuses any database name other than `vehicle_service_booking_test`.

- [ ] **Step 9: Verify the developer Compose replica separately.**

Run: `docker compose up -d mongo && docker compose run --rm mongo-init`

Expected: `mongo-init` exits 0 only after `rs0` is writable. If Docker is unavailable in the executor, record that environment limitation; the self-contained replica test remains mandatory.

- [ ] **Step 10: Record the non-Git checkpoint.**

Record exact command outputs and file hashes. The supplied project has no `.git`; do not initialize one solely for implementation checkpoints.

## Task 2: Booking policy, service normalization, availability, and state machine

**Files:**
- Create: `server/config/bookingPolicy.js`
- Create: `server/utils/serviceNormalization.js`
- Create: `server/services/availabilityService.js`
- Create: `server/services/bookingStateMachine.js`
- Create: `server/tests/services/availabilityService.test.js`
- Create: `server/tests/services/bookingStateMachine.test.js`

**Interfaces:**

```js
// bookingPolicy.js
module.exports = {
  WORKSHOP_TIME_ZONE, SLOT_MINUTES, MIN_LEAD_MINUTES, BOOKING_HORIZON_DAYS,
  MIN_DURATION_MINUTES, MAX_DURATION_MINUTES, MAX_BAY_COUNT, BOOKING_STATUSES,
  CAPACITY_RETAINING_STATUSES, CAPACITY_RELEASING_STATUSES,
};

// serviceNormalization.js
normalizeServiceName(value); toServiceSlug(value); toServiceNameKey(value);

// availabilityService.js
parseLocalDate(value); getDateInterval({ localDate, timeZone });
resolveOpeningInterval({ schedule, localDate });
validateOfferedStart({ schedule, startsAt, durationMinutes, now });
buildCandidateIntervals({ schedule, localDate, durationMinutes, now });
calculateAvailability({ schedule, service, bookings, localDate, now });
getAvailability({ serviceId, localDate, now = new Date() }): Promise<AvailabilityResult>;

// bookingStateMachine.js
assertTransitionAllowed({ currentStatus, toStatus, actorRole, startsAt, now, reason });
buildHistoryEntry({ fromStatus, toStatus, actor, reason, changedAt });
releasesCapacity(toStatus);
```

- [ ] **Step 1: Write failing pure-function tests for normalization and the scheduling grid.**

```js
assert.equal(toServiceSlug(" Periodic  Maintenance "), "periodic-maintenance");
assert.equal(toServiceNameKey("OIL & Filter Change"), "oil & filter change");
assert.throws(() => parseLocalDate("2026-02-30"), /YYYY-MM-DD/);
assert.equal(buildCandidateIntervals({ schedule, localDate: "2026-09-01", durationMinutes: 90, now }).length, 16);
assert.throws(() => validateOfferedStart({ schedule, startsAt: tooSoon, durationMinutes: 60, now }), /Booking action is not allowed at this time/);
```

Also add data-loading facade tests with injected model doubles: `getAvailability` rejects a missing or inactive service, loads the default workshop schedule, reads only bookings whose `reservedSlotKeys` exist over the candidate workshop date, and returns the complete-duration result from `calculateAvailability`.

- [ ] **Step 2: Write failing state-machine matrix tests.**

```js
assert.doesNotThrow(() => assertTransitionAllowed({ currentStatus: "requested", toStatus: "confirmed", actorRole: "admin", startsAt: future, now, reason: undefined }));
assert.throws(() => assertTransitionAllowed({ currentStatus: "confirmed", toStatus: "cancelled", actorRole: "customer", startsAt: past, now, reason: undefined }), /Booking action is not allowed at this time/);
assert.throws(() => assertTransitionAllowed({ currentStatus: "requested", toStatus: "rejected", actorRole: "admin", startsAt: future, now, reason: "   " }), /reason/i);
assert.equal(releasesCapacity("no_show"), true);
```

- [ ] **Step 3: Run both tests and verify they fail because the modules do not exist.**

Run: `cd server && npm test -- tests/services/availabilityService.test.js tests/services/bookingStateMachine.test.js`

Expected: FAIL with `MODULE_NOT_FOUND`.

- [ ] **Step 4: Implement immutable policy constants and normalizers.**

```js
const WORKSHOP_TIME_ZONE = "Asia/Kolkata";
const SLOT_MINUTES = 30;
const MIN_LEAD_MINUTES = 60;
const BOOKING_HORIZON_DAYS = 30;
const MIN_DURATION_MINUTES = 30;
const MAX_DURATION_MINUTES = 240;
const MAX_BAY_COUNT = 5;
const BOOKING_STATUSES = Object.freeze(["requested", "confirmed", "in_service", "completed", "cancelled", "rejected", "no_show"]);
const CAPACITY_RETAINING_STATUSES = Object.freeze(new Set(["requested", "confirmed", "in_service", "completed"]));
const CAPACITY_RELEASING_STATUSES = Object.freeze(new Set(["cancelled", "rejected", "no_show"]));

function normalizeServiceName(value) { return String(value ?? "").trim().replace(/\s+/g, " "); }
function toServiceSlug(value) { return normalizeServiceName(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
function toServiceNameKey(value) { return normalizeServiceName(value).toLocaleLowerCase("en"); }
```

- [ ] **Step 5: Implement availability with Luxon and no database writes.**

```js
const { DateTime } = require("luxon");

function parseLocalDate(value) {
  const date = DateTime.fromISO(value, { zone: WORKSHOP_TIME_ZONE });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !date.isValid || date.toISODate() !== value) throw new Error("Date must be a valid YYYY-MM-DD workshop date");
  return date.startOf("day");
}

function slotStartIso(instant) { return instant.toUTC().toISO({ suppressMilliseconds: false }); }
```

Implement `resolveOpeningInterval` by applying a matching date override before the ISO weekday record, and implement `calculateAvailability` by counting a bay as free only when every interval for that service duration has no matching reserved key.

Implement the public data-loading facade in the same module. It must load one active `Service`, load the singleton `WorkshopSchedule`, derive the candidate workshop-day UTC bounds, query only bookings with `reservedSlotKeys: { $exists: true }` that overlap those bounds, then delegate all policy math to `calculateAvailability`. Missing/inactive services return the approved safe service-not-found error, and missing schedule state fails closed.

```js
async function getAvailability({ serviceId, localDate, now = new Date() }) {
  const service = await Service.findOne({ _id: serviceId, isActive: true }).lean();
  if (!service) throw new AppError(404, "Service not found");
  const schedule = await WorkshopSchedule.findOne({ key: "default" }).lean();
  if (!schedule) throw new AppError(503, "Workshop schedule is unavailable");
  const { startsAt, endsAt } = getDateInterval({ localDate, timeZone: WORKSHOP_TIME_ZONE });
  const bookings = await Booking.find({
    reservedSlotKeys: { $exists: true },
    startsAt: { $lt: endsAt },
    endsAt: { $gt: startsAt },
  }).select("reservedSlotKeys").lean();
  return calculateAvailability({ schedule, service, bookings, localDate, now });
}
```

The implementation may inject models for focused unit tests, but its exported production signature remains exactly `getAvailability({ serviceId, localDate, now })` for Gate 2.

- [ ] **Step 6: Implement the only transition authority.**

```js
const RULES = Object.freeze({
  requested: new Set(["confirmed", "rejected", "cancelled"]),
  confirmed: new Set(["in_service", "cancelled", "no_show"]),
  in_service: new Set(["completed"]),
  completed: new Set(), cancelled: new Set(), rejected: new Set(), no_show: new Set(),
});

function buildHistoryEntry({ fromStatus, toStatus, actor, reason, changedAt }) {
  return { fromStatus: fromStatus ?? null, toStatus, changedAt, actor: { userId: actor._id, username: actor.username, role: actor.role }, reason: reason ?? null };
}
```

`assertTransitionAllowed` must throw `AppError(409, "Booking status no longer permits this action")` for illegal graph/actor transitions and `AppError(409, "Booking action is not allowed at this time")` for timing failures.

- [ ] **Step 7: Run focused pure tests and verify they pass.**

Run: `cd server && npm test -- tests/services/availabilityService.test.js tests/services/bookingStateMachine.test.js`

Expected: PASS for 30-day horizon, 60-minute lead, closure/override precedence, full-duration capacity, transitions, terminal states, and reason rules.

- [ ] **Step 8: Record the pure-domain checkpoint.**

Record focused PASS counts and reviewed files.

## Task 3: Service and workshop schedule persistence

**Files:**
- Create: `server/models/Service.js`
- Create: `server/models/WorkshopSchedule.js`
- Create: `server/services/serviceCatalogService.js`
- Create: `server/services/workshopScheduleService.js`
- Create: `server/tests/models/service.test.js`
- Create: `server/tests/models/workshopSchedule.test.js`
- Create: `server/tests/services/serviceCatalogService.test.js`
- Create: `server/tests/services/workshopScheduleService.test.js`

**Interfaces:**

```js
createService(input); updateService({ serviceId, patch }); getActiveService(serviceId);
listActiveServices(); adminListServices({ page, limit, isActive, search });
touchActiveService({ serviceId, session });
defaultWorkshopSchedule(); ensureDefaultWorkshopSchedule(); getWorkshopSchedule();
replaceWorkshopSchedule({ replacement, now }); touchWorkshopSchedule({ session });
assertScheduleSupportsBookings({ proposedSchedule, now, session });
```

- [ ] **Step 1: Write failing Service model/index tests.**

```js
const indexes = await Service.collection.indexes();
assert.equal(indexWithKey(indexes, { slug: 1 })[0].unique, true);
assert.equal(indexWithKey(indexes, { nameKey: 1 })[0].unique, true);
await assert.rejects(Service.create({ name: "A", category: "maintenance", description: "short", durationMinutes: 25 }), /ValidationError/);
```

- [ ] **Step 2: Write failing WorkshopSchedule full-document tests.**

```js
await assert.rejects(WorkshopSchedule.create({ ...defaultWorkshopSchedule(), weeklyHours: defaultWeeklyHours.slice(1) }), /ValidationError/);
await assert.rejects(WorkshopSchedule.create({ ...defaultWorkshopSchedule(), dateOverrides: [{ date: "2026-10-02", isClosed: true }, { date: "2026-10-02", isClosed: true }] }), /ValidationError/);
```

- [ ] **Step 3: Run model tests and verify `MODULE_NOT_FOUND`.**

Run: `cd server && npm test -- tests/models/service.test.js tests/models/workshopSchedule.test.js`

Expected: FAIL because both models are absent.

- [ ] **Step 4: Implement Service with guard and the exact indexes.**

```js
serviceSchema.index({ slug: 1 }, { unique: true });
serviceSchema.index({ nameKey: 1 }, { unique: true });
serviceSchema.index({ isActive: 1, name: 1 });

serviceSchema.pre("validate", function normalizeService() {
  this.name = normalizeServiceName(this.name);
  if (this.isNew) this.slug = toServiceSlug(this.name);
  this.nameKey = toServiceNameKey(this.name);
});
```

Declare `slug` immutable, `nameKey` with `select: false`, and `bookingGuardVersion` with `select: false`, `default: 0`, `min: 0`. `createService` constructs all three normalized values. `updateService` normalizes a patched `name` and sets `nameKey` but never rewrites `slug`; use the unique `nameKey` index for race-safe rename collisions.

- [ ] **Step 5: Implement WorkshopSchedule’s singleton/full-shape validator.**

```js
workshopScheduleSchema.index({ key: 1 }, { unique: true });

function validateWeeklyHours(hours) {
  return Array.isArray(hours) && hours.length === 7 && hours.every((entry, index) => entry.weekday === index + 1) && new Set(hours.map(({ weekday }) => weekday)).size === 7;
}
```

Store open/close values as integer minutes, reject overnight intervals, require values divisible by 30, cap overrides at 366, and reject duplicate override dates with the full-document validator.

- [ ] **Step 6: Implement catalog and schedule commands with transaction-safe guard touches.**

```js
async function touchActiveService({ serviceId, session }) {
  return Service.findOneAndUpdate({ _id: serviceId, isActive: true }, { $inc: { bookingGuardVersion: 1 } }, { new: true, session, timestamps: false });
}

async function touchWorkshopSchedule({ session }) {
  return WorkshopSchedule.findOneAndUpdate({ key: "default" }, { $inc: { bookingGuardVersion: 1 } }, { new: true, session, timestamps: false });
}
```

`replaceWorkshopSchedule` must create a complete proposed document, validate it, use `mongoose.startSession().withTransaction()`, call `assertScheduleSupportsBookings`, then replace the singleton while incrementing its guard.

Every normal `updateService` edit/deactivation increments `bookingGuardVersion` in the same timestamped update. Only `touchActiveService` is guard-only and uses `timestamps: false`; this ensures a concurrent booking either snapshots the complete old service or retries against the complete new service.

- [ ] **Step 7: Run Service and schedule model/service tests.**

Run: `cd server && npm test -- tests/models/service.test.js tests/models/workshopSchedule.test.js tests/services/serviceCatalogService.test.js tests/services/workshopScheduleService.test.js`

Expected: PASS for normalization, immutable slug, exact index set, all seven ordered weekdays, override uniqueness, `$setOnInsert` default behavior, and schedule conflict `409`.

- [ ] **Step 8: Record the service/schedule checkpoint.**

Record focused PASS counts and reviewed files; do not initialize Git solely for this unpacked project.

## Task 4: Booking schema and reservation-invariant firewall

**Files:**
- Create: `server/utils/bookingReservation.js`
- Create: `server/models/Booking.js`
- Create: `server/tests/models/booking.test.js`
- Create: `server/tests/models/bookingReservation.test.js`

**Interfaces:**

```js
buildReservedSlotKeys({ startsAt, durationMinutes, bayNumber });
assertBookingReservationInvariant(booking);
assertBookingUpdateShape(update);
hasCapacityReservation(status);
```

- [ ] **Step 1: Write failing reservation invariant tests.**

```js
assert.deepEqual(buildReservedSlotKeys({ startsAt: new Date("2026-09-01T03:30:00.000Z"), durationMinutes: 90, bayNumber: 1 }), [
  "2026-09-01T03:30:00.000Z|bay:1", "2026-09-01T04:00:00.000Z|bay:1", "2026-09-01T04:30:00.000Z|bay:1",
]);
await assert.rejects(Booking.create({ ...bookingInput(), status: "requested", reservedSlotKeys: [] }), /ValidationError/);
await assert.rejects(Booking.create({ ...bookingInput(), status: "cancelled", reservedSlotKeys: bookingKeys }), /ValidationError/);
```

- [ ] **Step 2: Write failing query-update firewall and index tests.**

```js
await assert.rejects(Booking.updateOne({ _id: booking._id }, { $set: { startsAt: new Date() } }, { runValidators: true }), /ValidationError/);
assert.equal(indexWithKey(await Booking.collection.indexes(), { reservedSlotKeys: 1 })[0].name, "uniq_booking_reserved_slot");
```

- [ ] **Step 3: Run the booking model tests and verify they fail.**

Run: `cd server && npm test -- tests/models/booking.test.js tests/models/bookingReservation.test.js`

Expected: FAIL with `MODULE_NOT_FOUND`.

- [ ] **Step 4: Implement canonical reservation keys and status relation checks.**

```js
function buildReservedSlotKeys({ startsAt, durationMinutes, bayNumber }) {
  const count = durationMinutes / SLOT_MINUTES;
  return Array.from({ length: count }, (_, index) => `${new Date(startsAt.getTime() + index * SLOT_MINUTES * 60000).toISOString()}|bay:${bayNumber}`);
}

function hasCapacityReservation(status) { return CAPACITY_RETAINING_STATUSES.has(status); }
```

Reject non-grid starts, duplicate values, array length mismatch, noncanonical values, `[]`, and reservation presence/absence inconsistent with status.

- [ ] **Step 5: Implement Booking schema indexes and managed-write middleware.**

```js
bookingSchema.index({ customer: 1, startsAt: -1 });
bookingSchema.index({ status: 1, startsAt: 1 });
bookingSchema.index({ vehicle: 1, startsAt: -1 });
bookingSchema.index({ reservedSlotKeys: 1 }, { unique: true, name: "uniq_booking_reserved_slot", partialFilterExpression: { reservedSlotKeys: { $exists: true } } });
```

All snapshots, `startsAt`, `endsAt`, `localDate`, `timeZone`, `bayNumber`, and creation fields are immutable. Query hooks must reject pipeline updates and managed-field update shapes other than sanctioned transition `$set` status, `$push` one history entry, and `$unset` reservation keys.

- [ ] **Step 6: Run model tests and verify all booking persistence constraints pass.**

Run: `cd server && npm test -- tests/models/booking.test.js tests/models/bookingReservation.test.js`

Expected: PASS for model/index checks, default omission, canonical reservation keys, history actor snapshot, and direct-update rejection.

- [ ] **Step 7: Record the Booking-persistence checkpoint.**

Record focused PASS counts and reviewed files.

## Task 5: Integrate booking guards, startup singleton, and explicit seed

**Files:**
- Modify: `server/models/Vehicle.js`
- Modify: `server/services/vehicleService.js`
- Modify: `server/index.js`
- Create: `server/scripts/seed-booking-foundation.js`
- Modify: `server/startup.test.js`
- Create: `server/tests/services/bookingFoundationSeed.test.js`

**Interfaces:**

```js
ensureDefaultWorkshopSchedule(): Promise<WorkshopScheduleDocument>;
seedBookingFoundation(): Promise<void>;
```

- [ ] **Step 1: Write failing startup and seed tests.**

```js
assert.deepEqual(events, ["config", "app", "connect", "indexes", "schedule", "listen:5001", "listening", "log"]);
await seedBookingFoundation();
const secondRun = await seedBookingFoundation();
assert.equal(await Service.countDocuments(), 6);
assert.equal((await WorkshopSchedule.countDocuments({ key: "default" })), 1);
```

- [ ] **Step 2: Run tests and verify startup does not yet initialize a schedule.**

Run: `cd server && npm test -- startup.test.js tests/services/bookingFoundationSeed.test.js`

Expected: FAIL because startup has no schedule lifecycle and the seed script is absent.

- [ ] **Step 3: Add Vehicle booking guard and increment it on all business edits.**

```js
bookingGuardVersion: { type: Number, default: 0, min: 0, select: false, required: true }
```

For `updateVehicle`, `archiveVehicle`, and `restoreVehicle`, add `$inc: { bookingGuardVersion: 1 }` to the existing successful business update. Do not expose this field from `vehicleResponse`.

- [ ] **Step 4: Extend startup ordering.**

```js
await connectDB(config.mongoUri);
connected = true;
await initialize();
await ensureDefaultWorkshopSchedule();
server = app.listen(config.port);
```

Include `Service`, `WorkshopSchedule`, and `Booking` in `initializeModels()`. The test injection shape becomes `ensureDefaultWorkshopSchedule: async () => { events.push("schedule"); }`.

- [ ] **Step 5: Implement the explicit idempotent seed command.**

```js
const DEFAULT_SERVICES = [
  ["Periodic Maintenance", "maintenance", "Scheduled inspection and preventive maintenance.", 90],
  ["Oil and Filter Change", "maintenance", "Engine oil and filter replacement service.", 60],
  ["Brake Inspection", "inspection", "Brake system inspection and condition assessment.", 60],
  ["Battery and Electrical Check", "electrical", "Battery, charging, and electrical system check.", 60],
  ["Wheel Alignment", "tyre", "Wheel alignment inspection and adjustment service.", 90],
  ["Vehicle Cleaning", "cleaning", "Exterior and interior vehicle cleaning service.", 60],
];
```

Call `ensureDefaultWorkshopSchedule()`, then `Service.updateOne({ slug }, { $setOnInsert: document }, { upsert: true })` for each entry. Never create users, alter vehicles, delete data, or overwrite existing service fields.

Construct every seed document explicitly because `updateOne` upsert does not run document `pre("validate")` normalization:

```js
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
};
await Service.updateOne({ slug: document.slug }, { $setOnInsert: document }, { upsert: true, runValidators: true });
```

- [ ] **Step 6: Run startup, seed, and existing vehicle tests.**

Run: `cd server && npm test -- startup.test.js tests/services/bookingFoundationSeed.test.js tests/services/vehicleService.test.js tests/models/vehicle.test.js`

Expected: PASS; startup fails closed if singleton initialization fails, seed remains idempotent, and existing vehicle behavior is unchanged except invisible guard increments.

- [ ] **Step 7: Record the startup/seed checkpoint.**

Record focused PASS counts and reviewed files.

## Task 6: Transactional booking creation and lifecycle commands

**Files:**
- Create: `server/services/bookingService.js`
- Create: `server/utils/bookingDuplicateKey.js`
- Create: `server/tests/services/bookingService.test.js`
- Create: `server/tests/utils/bookingDuplicateKey.test.js`

**Interfaces:**

```js
createBooking({ customer, vehicleId, serviceId, startsAt, notes, now });
listCustomerBookings({ customer, scope, status, page, limit, now });
getCustomerBooking({ customer, bookingId });
getAdminBooking({ bookingId });
listAdminBookings({ page, limit, status, dateFrom, dateTo, search });
cancelBooking({ bookingId, actor, reason, now });
transitionBooking({ bookingId, actor, toStatus, reason, now });
isReservationKeyDuplicate(error);
```

- [ ] **Step 1: Write failing booking service tests for creation and capacity release.**

```js
const booking = await createBooking({ customer, vehicleId: vehicle.id, serviceId: service.id, startsAt, notes: "Battery check", now });
assert.equal(booking.status, "requested");
assert.equal(booking.endsAt.getTime() - booking.startsAt.getTime(), 90 * 60000);
assert.equal(booking.statusHistory.length, 1);
await cancelBooking({ bookingId: booking.id, actor: customer, reason: "Cannot attend", now });
assert.equal((await Booking.findById(booking.id)).reservedSlotKeys, undefined);
```

- [ ] **Step 2: Write failing service tests for ownership, active records, and transitions.**

```js
await assert.rejects(createBooking({ customer: otherCustomer, vehicleId: vehicle.id, serviceId: service.id, startsAt, now }), (error) => error.statusCode === 404 && error.message === "Vehicle not found");
await assert.rejects(createBooking({ customer, vehicleId: archivedVehicle.id, serviceId: service.id, startsAt, now }), /Vehicle not found/);
await assert.rejects(transitionBooking({ bookingId: booking.id, actor: customer, toStatus: "confirmed", now }), /Booking status no longer permits this action/);
```

- [ ] **Step 3: Run focused service test and verify it fails.**

Run: `cd server && npm test -- tests/services/bookingService.test.js tests/utils/bookingDuplicateKey.test.js`

Expected: FAIL with `MODULE_NOT_FOUND`.

- [ ] **Step 4: Implement transactional creation with fresh candidate transactions.**

```js
async function createBooking(input) {
  for (let bayNumber = 1; bayNumber <= MAX_BAY_COUNT; bayNumber += 1) {
    const attempt = await attemptBookingInBay({ ...input, bayNumber });
    if (attempt.kind === "created") return attempt.booking;
    if (attempt.kind === "bay-unavailable") break;
    if (attempt.kind !== "reservation-conflict") throw attempt.error;
  }
  throw new AppError(409, "That time is no longer available");
}
```

`attemptBookingInBay` creates and closes a fresh session. Inside `withTransaction`, `createBookingInBay` conditionally `$inc`s Vehicle, Service, and WorkshopSchedule guards with `timestamps: false`, derives all snapshots/keys from returned documents, and inserts the initial history event. If `bayNumber > schedule.bayCount`, throw an internal `BayUnavailable` sentinel inside the callback so the transaction aborts and guard increments roll back; the wrapper returns `{ kind: "bay-unavailable" }`. Only `isReservationKeyDuplicate(error)`, matched by index name `uniq_booking_reserved_slot` with the exact key-pattern fallback, becomes `{ kind: "reservation-conflict" }`; every other `E11000` is rethrown to its dedicated mapper.

- [ ] **Step 5: Implement conditional lifecycle transitions.**

```js
const update = { $set: { status: toStatus }, $push: { statusHistory: buildHistoryEntry({ fromStatus: current.status, toStatus, actor, reason, changedAt: now }) } };
if (releasesCapacity(toStatus)) update.$unset = { reservedSlotKeys: "" };
const updated = await Booking.findOneAndUpdate({ _id: bookingId, status: current.status }, update, { new: true, runValidators: true });
if (!updated) throw new AppError(409, "Booking status no longer permits this action");
```

Load the target booking through customer ownership when `actor.role === "customer"`; otherwise load by id for admin. Both missing and unauthorized customer accesses map to `404 Booking not found`.

- [ ] **Step 6: Run focused booking service tests.**

Run: `cd server && npm test -- tests/services/bookingService.test.js tests/utils/bookingDuplicateKey.test.js`

Expected: PASS for server-derived fields, active ownership, immutable snapshots, create/cancel/rejection/no-show capacity behavior, history snapshots, and exact errors.

- [ ] **Step 7: Record the booking-command checkpoint.**

Record focused PASS counts and reviewed files.

## Task 7: Race, serialization, and full Gate 1 regression

**Files:**
- Create: `server/tests/services/bookingService.race.test.js`
- Modify: `server/tests/services/bookingService.test.js`

**Interfaces:**
- Consumes only the public `bookingService` commands and model/service setup helpers from earlier tasks.
- Produces repeatable proof that capacity, snapshots, and schedule validity survive concurrent commands.

- [ ] **Step 1: Write failing same-slot and long-slot overlap race tests.**

```js
await replaceWorkshopSchedule({ replacement: { ...defaultWorkshopSchedule(), bayCount: 1 }, now });
const results = await Promise.allSettled([createBooking(inputA), createBooking(inputB)]);
assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
assert.equal(results.filter((result) => result.status === "rejected")[0].reason.message, "That time is no longer available");

const longBooking = await createBooking({ ...inputA, serviceId: ninetyMinuteService.id });
await assert.rejects(createBooking({ ...inputB, serviceId: thirtyMinuteService.id, startsAt: new Date(longBooking.startsAt.getTime() + 30 * 60000) }), /That time is no longer available/);
```

Each collision/overlap test creates a fresh fixture with `bayCount: 1` (or explicitly occupies every other bay). The default two-bay schedule must never be used for a one-winner assertion.

- [ ] **Step 2: Write failing create-versus-mutation race tests.**

```js
const [bookingResult, archiveResult] = await Promise.allSettled([
  createBooking(input), archiveVehicle({ owner: customer._id, vehicleId: vehicle.id }),
]);
assert.equal(bookingResult.status === "fulfilled" || archiveResult.status === "fulfilled", true);
if (bookingResult.status === "fulfilled") assert.equal(bookingResult.value.vehicleSnapshot.registrationNumber, vehicle.registrationNumber);
```

Add these two concrete cases in the same test file:

```js
const [serviceBooking, serviceEdit] = await Promise.allSettled([
  createBooking(input),
  updateService({ serviceId: service.id, patch: { durationMinutes: 60 } }),
]);
if (serviceBooking.status === "fulfilled") {
  const duration = serviceBooking.value.serviceSnapshot.durationMinutes;
  assert.equal([60, 90].includes(duration), true);
  assert.equal(serviceBooking.value.reservedSlotKeys.length, duration / 30);
}
assert.equal(serviceBooking.status === "fulfilled" || serviceEdit.status === "fulfilled", true);

const shortenedSchedule = { bayCount: 1, weeklyHours: weeklyHoursClosingAt("10:00"), dateOverrides: [] };
const [scheduledBooking, scheduleEdit] = await Promise.allSettled([
  createBooking(inputAt("2026-09-01T03:30:00.000Z")),
  replaceWorkshopSchedule({ replacement: shortenedSchedule, now }),
]);
if (scheduledBooking.status === "fulfilled") {
  assert.equal(scheduledBooking.value.endsAt.toISOString(), "2026-09-01T05:00:00.000Z");
  assert.equal(scheduleEdit.status, "rejected");
  assert.equal(scheduleEdit.reason.message, "Schedule change conflicts with existing bookings");
} else {
  assert.equal(scheduleEdit.status, "fulfilled");
  assert.equal(scheduledBooking.reason.message, "That time is no longer available");
}
```

The service race accepts either complete old or complete new service version; it rejects hybrid snapshot/key counts. The schedule race accepts only the two serial orders above and rejects the impossible outcome where both the shortened schedule and the old-schedule booking commit.

- [ ] **Step 3: Run race tests and verify they initially fail until transactional service behavior is complete.**

Run: `cd server && npm test -- tests/services/bookingService.race.test.js`

Expected: FAIL if any booking exceeds bay capacity, overlaps a longer interval, or persists after a conflicting invalid schedule change.

- [ ] **Step 4: Add deterministic transaction retry assertions and timestamp-guard tests.**

```js
const before = await Vehicle.findById(vehicle.id).select("+bookingGuardVersion");
await createBooking(input);
const after = await Vehicle.findById(vehicle.id).select("+bookingGuardVersion");
assert.equal(after.updatedAt.getTime(), before.updatedAt.getTime());
assert.equal(after.bookingGuardVersion, before.bookingGuardVersion + 1);
```

Add these concrete Service and WorkshopSchedule assertions immediately after the Vehicle assertion:

```js
const serviceBefore = await Service.findById(service.id).select("+bookingGuardVersion");
const scheduleBefore = await WorkshopSchedule.findOne({ key: "default" }).select("+bookingGuardVersion");
await createBooking(nextFreeInput);
const serviceAfter = await Service.findById(service.id).select("+bookingGuardVersion");
const scheduleAfter = await WorkshopSchedule.findOne({ key: "default" }).select("+bookingGuardVersion");
assert.equal(serviceAfter.updatedAt.getTime(), serviceBefore.updatedAt.getTime());
assert.equal(scheduleAfter.updatedAt.getTime(), scheduleBefore.updatedAt.getTime());
assert.equal(serviceAfter.bookingGuardVersion, serviceBefore.bookingGuardVersion + 1);
assert.equal(scheduleAfter.bookingGuardVersion, scheduleBefore.bookingGuardVersion + 1);
```

Make the retry test issue two `createBooking` calls for the final available bay; after settlement, reload each persisted booking and assert that `reservedSlotKeys` equals `buildReservedSlotKeys({ startsAt, durationMinutes: booking.serviceSnapshot.durationMinutes, bayNumber: booking.bayNumber })`.

- [ ] **Step 5: Run the race test five times.**

Run: `cd server && for i in 1 2 3 4 5; do npm test -- tests/services/bookingService.race.test.js || exit 1; done`

Expected: five PASS runs; no duplicate reservation key, capacity overflow, stale snapshot, or schedule-invalid booking.

- [ ] **Step 6: Run the complete server regression.**

Run: `cd server && npm test`

Expected: PASS for all existing auth/vehicle/startup tests and every Gate 1 model/service/race test.

- [ ] **Step 7: Record the race-evidence checkpoint.**

Record all five PASS runs, the full server count, and reviewed files.

## Gate 1 completion checklist

- [ ] `cd server && npm test -- tests/helpers/testDb.test.js` starts an isolated writable `rs0`; when Docker is available, `docker compose up -d mongo && docker compose run --rm mongo-init` independently verifies the development replica.
- [ ] Startup initializes all indexes and exactly one default schedule before listening, and fails closed when either step fails.
- [ ] The explicit seed is idempotent and preserves administrator changes.
- [ ] Service, schedule, Booking, and Vehicle guard model tests pass against the guarded replica-set test database.
- [ ] Availability calculations respect local timezone, opening overrides, full duration, lead time, and the exact 30-date horizon.
- [ ] No direct Booking managed-field update can violate status/history/reservation invariants.
- [ ] Same-time race tests demonstrate the named unique reservation index is the final overlap arbiter.
- [ ] Creation-vs-vehicle/service/schedule mutation races demonstrate transaction-consistent rules and unchanged guard-touch timestamps.
- [ ] `cd server && npm test` passes before Gate 2 begins.
