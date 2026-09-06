# Dashboard Insights v1.1.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a role-safe, read-only dashboard that gives customers an exact next action and gives administrators deterministic workshop workload and attention insights.

**Architecture:** Mount one protected `GET /api/dashboard` boundary that reloads the current user, rejects every query parameter, captures one clock instant, and dispatches to role-specific read-only aggregation services. Build responses through explicit allowlist serializers, then render them through one protected React coordinator and separate customer/admin presentational components without adding a chart library or any new persisted data.

**Tech Stack:** Node.js 24, CommonJS, Express 5, Mongoose 9, MongoDB 8 replica-set tests, Luxon, node:test, Supertest; React 19, React Router 7, Vite 8, Vitest 4, Testing Library, ESLint.

**Spec:** `docs/superpowers/specs/2026-08-30-dashboard-insights-design.md`

## Global Constraints

- The dashboard is read-only. Add only `GET /api/dashboard`; do not add a dashboard POST, PATCH, PUT, or DELETE route.
- Authentication must reload the current database user before role authorization; only current `customer` and `admin` roles may continue.
- Reject every unknown, repeated, or non-scalar dashboard query parameter through the existing structured `400` contract.
- Capture exactly one valid `Date` per request and derive every count, local date, workload boundary, and attention boundary from that instant.
- Use the existing fixed workshop zone `Asia/Kolkata`, seven ascending local calendar dates, and existing weekly-hours/date-override schedule contract.
- Do not add payments, messaging, external AI, telematics, mileage, maintenance intervals, predictive claims, caches, analytics collections, scheduled jobs, or denormalized counters.
- Use immutable booking snapshots for dashboard vehicle/service presentation; never read current vehicle/service text to rewrite historical bookings.
- A customer response must never expose customer identity, administrator identity, raw references, actor IDs, bay numbers, reservation keys, guard versions, credentials, or token fields.
- An administrator response may expose only the documented customer `id`, `username`, and `email` inside attention items; it must not expose actor history, bay numbers, reservation keys, guard versions, credentials, or token fields.
- `byStatus` always contains, in order, `requested`, `confirmed`, `in_service`, `completed`, `cancelled`, `rejected`, and `no_show`, including numeric zero values.
- Workload always contains exactly seven ascending local dates. Closed or unavailable opening rows have zero capacity and zero utilization.
- Count workload reservations only for `requested`, `confirmed`, and `in_service` bookings that retain `reservedSlotKeys`; sum immutable `serviceSnapshot.durationMinutes` once per booking.
- Dashboard workload deliberately excludes `completed` even when its historical reservation keys remain stored: the dashboard spec defines completed work as no longer occupying future workload. This does not change the core reservation, availability, or index contracts.
- `todayAppointments` and each workload row's `appointmentCount` use the same live-workload predicate as `reservedMinutes`: `requested`, `confirmed`, or `in_service` with `reservedSlotKeys` present.
- Missing workshop schedule is the existing controlled `503` error; do not invent capacity.
- Customer action priority is exact: view nearest upcoming booking, otherwise book service when an active vehicle exists, otherwise add the first vehicle.
- Administrator attention priority is exact: overdue confirmed, requested within the next 24 hours, then in-service; sort by priority, start instant, then identifier; return at most five.
- The client performs one dashboard request per mount and one per Retry, ignores stale/unmounted settlements, and handles a current `401` once through the existing protected-session redirect.
- Render role-specific content only when the response role exactly matches the authenticated current role.
- Use semantic text and `<progress max="100">` for workload; status and utilization meaning must remain understandable without color.
- Preserve the current profile fields, role-specific account links, password action, and single-flight sign-out behavior.
- No new npm dependency, model, persisted field, or index is permitted unless implementation evidence proves the existing query indexes inadequate. The default plan adds none.
- Attention kinds are a closed implementation enum mapped one-to-one to the approved rules: `overdue_confirmed`, `requested_soon`, and `in_service`.
- Server command blocks run from `server/`, client command blocks run from `client/`, and release/Git commands run from the project root unless the block explicitly changes directory.
- Every production behavior is implemented through red-green-refactor: write the focused test, run it and observe the expected failure, add the minimum implementation, then rerun it green.
- Preserve the verified Core Booking v1.0.0 source and archive identity. Package this work separately as `VehicleServiceBooking-dashboard-insights-v1.1.0.zip` with an external checksum.

---

## File Map

### Server

- Create `server/utils/dashboardResponse.js`: identifier/date cloning plus exact customer/admin response builders.
- Create `server/tests/utils/dashboardResponse.test.js`: serializer shape, cloning, action, zero-fill, and privacy contracts.
- Create `server/services/dashboardService.js`: injectable read-only customer/admin queries, local-day boundaries, workload math, and attention ordering.
- Create `server/tests/services/dashboardService.test.js`: injected-query and live replica-set dashboard behavior.
- Create `server/controllers/dashboardController.js`: capture one request instant and dispatch by current database role.
- Create `server/routes/dashboardRoutes.js`: authentication, authorization, empty-query guard, and controller order.
- Create `server/tests/dashboardRoutes.test.js`: HTTP envelope, role reload, ownership/privacy, method, and no-write checks.
- Modify `server/app.js`: mount `/api/dashboard` before the not-found boundary.

### Client

- Create `client/src/api/dashboardApi.js`: one protected `GET /dashboard` wrapper.
- Create `client/src/api/dashboardApi.test.js`: exact request and error-forwarding behavior.
- Modify `client/src/api/authApi.js` and `client/src/api/authApi.test.js`: narrowly allow documented dashboard display strings while retaining credential detection.
- Create `client/src/components/DashboardStatCard.jsx` and `.test.jsx`: semantic labelled statistic.
- Create `client/src/components/CustomerDashboard.jsx` and `.test.jsx`: customer counts, appointment/action, and recent activity.
- Create `client/src/components/AdminDashboard.jsx` and `.test.jsx`: status counts, seven-day workload, and attention queue.
- Modify `client/src/pages/DashboardPage.jsx`: strict response normalization, request lifecycle, role dispatch, profile/actions, and logout.
- Create `client/src/pages/dashboardPage.test.jsx`: coordinator loading, retry, validation, role, stale request, 401, and privacy behavior.
- Modify `client/src/pages/accountFlows.test.jsx`, `client/src/App.test.jsx`, `client/src/pages/linkFlows.test.jsx`, and `client/src/auth/bootstrapRecovery.test.jsx`: role-matched dashboard API fixtures and regressions.
- Modify `client/src/styles/index.css` and `client/src/styles/index.css.test.js`: responsive cards/workload, badge/progress semantics, forced colors, and narrow-width protection.

### Release and documentation

- Modify `README.md`: dashboard capability, route, demo, verification, version, and limitations.
- Modify `docs/api/core-booking-api.md`: exact dashboard request/response/error contract.
- Create `docs/acceptance/dashboard-insights-browser-checklist.md`: real-browser 320/768/1440 evidence matrix.
- Create `docs/release/dashboard-insights-v1.1.0-verification.md`: fresh automated results, blockers, archive identity, and checksum.
- Modify `scripts/release-verify.sh` and `server/tests/release/releaseVerifier.test.js`: v1.1.0 internal root, required dashboard files, safe exclusions, and independent manifest verification.

---

### Task 1: Safe Dashboard Response Boundary

**Files:**
- Create: `server/tests/utils/dashboardResponse.test.js`
- Create: `server/utils/dashboardResponse.js`

**Interfaces:**
- Produces: `toCustomerDashboard(input) -> CustomerDashboard`
- Produces: `toAdminDashboard(input) -> AdminDashboard`
- Both functions return the inner `dashboard` object, clone every exposed `Date`, normalize identifiers to strings, allocate new nested objects/arrays, and never mutate input.

- [ ] **Step 1: Write failing customer serializer tests**

Create literal fixtures containing allowed fields plus `_id`, `__v`, `customer`, `actor.userId`, `bayNumber`, `reservedSlotKeys`, `bookingGuardVersion`, `password`, and `token`. Assert the exact result:

```js
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
```

Add separate literal tests for `book_service` and `add_vehicle`; test newest-five input preservation, `reason: null`, independent date/object cloning, and absence of every forbidden key through a recursive key scan.

- [ ] **Step 2: Run the customer serializer test and verify RED**

Run from `server/`:

```bash
npm test -- tests/utils/dashboardResponse.test.js
```

Expected: FAIL because `../../utils/dashboardResponse` does not exist.

- [ ] **Step 3: Implement the minimal customer serializer**

Use closed builders, never object spread from a document:

```js
const ACTOR_LABELS = Object.freeze({ customer: "Customer", admin: "Administrator" });

function identifier(value) {
  if (value == null) return undefined;
  if (typeof value === "string") return value;
  if (typeof value.toHexString === "function") return value.toHexString();
  return identifier(value.id ?? value._id);
}

function cloneDate(value) {
  return value instanceof Date ? new Date(value.getTime()) : value;
}

function customerAction({ nextBooking, activeVehicles }) {
  if (nextBooking) return {
    kind: "view_booking",
    href: `/bookings/${identifier(nextBooking)}`,
    label: "View your next appointment",
  };
  if (activeVehicles > 0) return {
    kind: "book_service",
    href: "/book-service",
    label: "Book a service",
  };
  return {
    kind: "add_vehicle",
    href: "/vehicles",
    label: "Add your first vehicle",
  };
}
```

Complete the exact `toCustomerDashboard` projection defined by the spec and tests.

- [ ] **Step 4: Rerun the customer serializer test and verify GREEN**

Run the same command. Expected: customer serializer assertions pass.

- [ ] **Step 5: Write failing administrator serializer tests**

Use literal input for all statuses, seven workload rows, and attention records. Assert exact `role`, `generatedAt`, summary, zero-filled ordered statuses, bounded workload projection, allowed attention identity, and exact `/admin/bookings/<id>` href. Mutate returned dates/objects and prove the input did not change. Recursively prove forbidden keys are absent.

- [ ] **Step 6: Run the administrator serializer test and verify RED**

Run the focused test. Expected: FAIL because `toAdminDashboard` is absent or incomplete.

- [ ] **Step 7: Implement the minimal administrator serializer**

Fill the seven statuses from `BOOKING_STATUSES`, clone workload rows, and project attention through explicit object literals. Export only:

```js
module.exports = { toCustomerDashboard, toAdminDashboard };
```

- [ ] **Step 8: Run the full serializer file and commit**

```bash
npm test -- tests/utils/dashboardResponse.test.js
git add server/utils/dashboardResponse.js server/tests/utils/dashboardResponse.test.js
git commit -m "feat: add safe dashboard response builders"
```

Expected: focused tests pass and the commit contains only Task 1 files.

---

### Task 2: Customer Dashboard Aggregation

**Files:**
- Create: `server/tests/services/dashboardService.test.js`
- Create: `server/services/dashboardService.js`

**Interfaces:**
- Consumes: `toCustomerDashboard(input)` from Task 1.
- Produces: `createDashboardService({ Booking, Vehicle, WorkshopSchedule, User, resolveOpeningInterval, isValidObjectId })`.
- Produces: `getCustomerDashboard({ customerId, now }) -> Promise<CustomerDashboard>`.

- [ ] **Step 1: Write failing injected-service tests**

Create model doubles whose write methods throw. Prove invalid `now` rejects before `Vehicle.countDocuments` or `Booking.aggregate`; a valid call performs exactly `Vehicle.countDocuments({ owner: customerId, status: "active" })` and one customer-first aggregation. Add an archived-only fixture that must choose `add_vehicle`. Assert the first aggregation stage is:

```js
{ $match: { customer: customerId } }
```

Assert the aggregation contains facets for summary counts, nearest upcoming booking, and recent activity; `$unwind` of `statusHistory` occurs only inside a facet after the customer match.

- [ ] **Step 2: Run the service test and verify RED**

```bash
npm test -- tests/services/dashboardService.test.js
```

Expected: FAIL because `dashboardService.js` does not exist.

- [ ] **Step 3: Implement the injectable service shell and customer pipeline**

Use the exact upcoming predicate:

```js
const upcomingFilter = {
  $or: [
    { status: { $in: ["requested", "confirmed"] }, endsAt: { $gte: now } },
    { status: "in_service" },
  ],
};
```

Create one customer-scoped `$facet` that returns:

- upcoming count using `upcomingFilter`;
- completed count using `{ status: "completed" }`;
- next booking using `upcomingFilter`, `{ startsAt: 1, _id: 1 }`, and limit one;
- recent activity by unwinding `statusHistory` with an array index, sorting `statusHistory.changedAt` descending, `_id` ascending, then array index descending, and limiting five.

Normalize empty facet arrays to zero/null/empty before calling `toCustomerDashboard`.

- [ ] **Step 4: Run the injected tests and verify GREEN**

Run the focused service test. Expected: injected behavior passes without a database.

- [ ] **Step 5: Write failing live customer dashboard tests**

Using the guarded replica-set helper, create two customers with mixed bookings and history. Test literal results for:

- ownership isolation before unwind/projection;
- active vehicle count;
- requested/confirmed/in-service upcoming semantics;
- completed count;
- deterministic nearest booking tie by `_id`;
- newest five history events with generic actor labels;
- view-booking, book-service, and add-vehicle action priority;
- exact absence of foreign-customer and administrator identifiers;
- no document mutation or write operation.

- [ ] **Step 6: Run live customer tests and verify RED**

Run the focused service file. Expected: at least one customer behavior fails before the complete pipeline/result mapping is present.

- [ ] **Step 7: Complete the customer aggregation and mapping**

Use booking snapshots and scheduling fields only. Do not populate User, Vehicle, or Service for customer dashboard data.

- [ ] **Step 8: Run the service tests and commit**

```bash
npm test -- tests/services/dashboardService.test.js
git add server/services/dashboardService.js server/tests/services/dashboardService.test.js
git commit -m "feat: add customer dashboard aggregation"
```

Expected: customer service tests pass. Export the factory and default customer method; Task 3 adds the administrator method only after its failing tests exist.

---

### Task 3: Administrator Workload and Attention Aggregation

**Files:**
- Modify: `server/tests/services/dashboardService.test.js`
- Modify: `server/services/dashboardService.js`

**Interfaces:**
- Consumes: `toAdminDashboard(input)` from Task 1.
- Produces: `getAdminDashboard({ now }) -> Promise<AdminDashboard>`.
- Produces the final module surface by spreading a default production instance while retaining the injectable factory:

```js
const dashboardService = createDashboardService({
  Booking,
  Vehicle,
  WorkshopSchedule,
  User,
  resolveOpeningInterval,
});

module.exports = { ...dashboardService, createDashboardService };
```

- [ ] **Step 1: Write failing injected administrator tests**

Prove invalid `now` makes zero model reads. For a valid time, assert one read-only `WorkshopSchedule.findOne({ key: "default" }).lean()` and one admin aggregation. Assert a missing schedule rejects with:

```js
new AppError(503, "Workshop schedule is unavailable")
```

Make every model write method a throwing sentinel and assert it remains untouched.

- [ ] **Step 2: Run the administrator service tests and verify RED**

Run the service test file. Expected: administrator tests fail because `getAdminDashboard` is not complete.

- [ ] **Step 3: Implement shared local boundaries and admin facet**

Derive all boundaries from one instant:

```js
const localNow = DateTime.fromJSDate(now, { zone: WORKSHOP_TIME_ZONE });
const firstDay = localNow.startOf("day");
const dates = Array.from({ length: 7 }, (_value, index) =>
  firstDay.plus({ days: index }).toISODate());
const todayStart = firstDay.toUTC().toJSDate();
const tomorrowStart = firstDay.plus({ days: 1 }).toUTC().toJSDate();
const afterSeventhStart = firstDay.plus({ days: 7 }).toUTC().toJSDate();
const attentionEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000);
```

Use one `$facet` for total count, grouped statuses, today's live appointment count, seven-day live appointment/reserved-minute workload, and attention. Both `todayAppointments` and workload `appointmentCount` use the same exact predicate as reserved minutes. Workload match is exact:

```js
{
  status: { $in: ["requested", "confirmed", "in_service"] },
  reservedSlotKeys: { $exists: true },
  startsAt: { $gte: todayStart, $lt: afterSeventhStart },
}
```

Sum `serviceSnapshot.durationMinutes`. Attention `$match` uses the three exact inclusive rules, adds priority with `$switch`, sorts `{ priority: 1, startsAt: 1, _id: 1 }`, limits five, looks up the associated user, and projects only documented fields.

- [ ] **Step 4: Write failing deterministic workload tests**

Create a literal schedule that includes an open weekday, closed weekday, open date override, and closed date override. Test:

- seven ascending `YYYY-MM-DD` rows beginning with local today;
- override precedence over weekday;
- `(closeMinutes - openMinutes) * bayCount` capacity;
- zero capacity/utilization on closed days;
- reserved-duration sum once per booking, including a 90-minute booking;
- exclusion of completed/cancelled/rejected/no-show from workload;
- identical appointment-count and reserved-minute predicates, including a completed booking that still retains historical reservation keys;
- one-decimal rounding and cap at 100;
- Asia/Kolkata midnight boundary and today appointment count.

- [ ] **Step 5: Run workload tests and verify RED**

Expected: capacity or date-boundary assertions fail before workload mapping is complete.

- [ ] **Step 6: Implement workload mapping**

For each date, call the injected existing `resolveOpeningInterval({ schedule, localDate: date })`. Calculate:

```js
const availableBayMinutes = opening
  ? opening.endsAt.diff(opening.startsAt, "minutes").minutes * schedule.bayCount
  : 0;
const utilizationPercent = availableBayMinutes === 0
  ? 0
  : Math.min(100, Math.round((reservedMinutes / availableBayMinutes) * 1000) / 10);
```

- [ ] **Step 7: Write failing attention and status tests**

Test every status including zero fill, overdue-confirmed inclusive `startsAt === now`, requested inclusive at `now` and `now + 24h`, all in-service, exclusion just beyond boundaries, priority ordering, start/id tie-breaks, five-item limit, exact customer identity, and no actor/bay/reservation output. Assert each item has the exact mapped kind: `overdue_confirmed`, `requested_soon`, or `in_service`.

- [ ] **Step 8: Complete admin mapping, run tests, and commit**

Before adding any optional index, capture `explain("executionStats")` for the implemented query. Add an index only when that evidence demonstrates a concrete need; then add a named Booking-index and startup initialization regression and record the explain result. With the planned facet query, keep the existing indexes and record that no index was added.

```bash
npm test -- tests/services/dashboardService.test.js
git add server/services/dashboardService.js server/tests/services/dashboardService.test.js
git commit -m "feat: add administrator dashboard insights"
```

Expected: all customer/admin service tests pass.

---

### Task 4: Protected Dashboard HTTP Boundary

**Files:**
- Create: `server/tests/dashboardRoutes.test.js`
- Create: `server/controllers/dashboardController.js`
- Create: `server/routes/dashboardRoutes.js`
- Modify: `server/app.js`

**Interfaces:**
- Consumes: `dashboardService.getCustomerDashboard({ customerId, now })` and `getAdminDashboard({ now })`.
- Produces: `GET /api/dashboard -> 200 { dashboard }`.

- [ ] **Step 1: Write failing middleware-order and method tests**

Assert:

- unauthenticated `GET /api/dashboard?bad=1` returns authentication `401`, not validation `400`;
- authenticated customer/admin requests with any unknown or repeated query key return structured `400`;
- customer/admin success uses exactly `{ dashboard }`;
- POST, PATCH, PUT, and DELETE return `404` and make no dashboard service call.

- [ ] **Step 2: Run route tests and verify RED**

```bash
npm test -- tests/dashboardRoutes.test.js
```

Expected: `404` for the missing GET route.

- [ ] **Step 3: Add router, controller, and app mount**

Create the exact middleware order:

```js
router.get(
  "/",
  asyncHandler(authenticate),
  authorize("customer", "admin"),
  rejectUnknownQueryFields([]),
  asyncHandler(dashboardController.getDashboard),
);
```

Controller contract:

```js
async function getDashboard(req, res) {
  const now = new Date();
  const dashboard = req.user.role === "admin"
    ? await dashboardService.getAdminDashboard({ now })
    : await dashboardService.getCustomerDashboard({ customerId: req.user._id, now });
  res.status(200).json({ dashboard });
}
```

Mount `app.use("/api/dashboard", createDashboardRouter())` before `notFound`.

- [ ] **Step 4: Run route tests and verify GREEN for boundary basics**

Run the focused route file. Expected: auth/query/method tests pass.

- [ ] **Step 5: Write failing live HTTP privacy and role-reload tests**

Test exact customer/admin response shapes, mixed-customer privacy, and no persisted modification. Bound `generatedAt` between instants captured immediately before and after the request rather than comparing a nondeterministic whole-response string; deterministic clock boundaries remain service-level tests. Log in, change the database user's role, then request the dashboard and assert the current database role selects the projection. Snapshot booking, vehicle, and schedule documents before/after and assert byte-for-byte equality.

- [ ] **Step 6: Complete integration and error behavior**

Keep database failures unwrapped so the existing centralized handler returns the controlled `500`. Do not add route-specific error logging or mutation middleware.

- [ ] **Step 7: Run server feature regression, lint, and commit**

```bash
npm test -- tests/utils/dashboardResponse.test.js tests/services/dashboardService.test.js tests/dashboardRoutes.test.js tests/security/app-security.test.js
npm run lint
git add server/app.js server/controllers/dashboardController.js server/routes/dashboardRoutes.js server/tests/dashboardRoutes.test.js
git commit -m "feat: expose protected dashboard endpoint"
```

Expected: focused tests and server lint pass.

---

### Task 5: Dashboard Client API and Credential Scanner

**Files:**
- Create: `client/src/api/dashboardApi.test.js`
- Create: `client/src/api/dashboardApi.js`
- Modify: `client/src/api/authApi.test.js`
- Modify: `client/src/api/authApi.js`

**Interfaces:**
- Produces: `dashboardApi.get() -> apiRequest("/dashboard")`.
- Extends the existing sensitive-success scanner only for documented display-text paths on `GET /dashboard`.

- [ ] **Step 1: Write failing dashboard API tests**

Use a real mocked `fetch` boundary and assert URL `http://localhost:5000/api/dashboard`, method default `GET`, `credentials: "include"`, no body, no content-type header, response envelope pass-through, and unchanged `ApiError` status/message forwarding.

- [ ] **Step 2: Run API tests and verify RED**

```bash
npm test -- --run src/api/dashboardApi.test.js
```

Expected: FAIL because `dashboardApi.js` does not exist.

- [ ] **Step 3: Implement the API wrapper**

```js
import { apiRequest } from "./authApi";

function get() {
  return apiRequest("/dashboard");
}

export const dashboardApi = { get };
```

- [ ] **Step 4: Run API tests and verify GREEN**

Run the focused file. Expected: wrapper behavior passes.

- [ ] **Step 5: Write failing scanner tests**

Pass JWT-shaped literal display strings through documented dashboard fields such as `dashboard.nextBooking.service.name`, vehicle make/model, activity reason, and admin attention service/customer text. Prove nested `token`, `password`, and undocumented JWT-shaped values remain rejected on `/dashboard`, and the same display paths remain rejected on a wrong method or endpoint.

- [ ] **Step 6: Extend scanner path allowlists minimally**

Add exact dashboard text-path patterns and a `GET /dashboard` branch in `isDocumentedResponseTextPath`. Do not exempt the whole dashboard object or identifier/href fields.

- [ ] **Step 7: Run API/scanner tests and commit**

```bash
npm test -- --run src/api/dashboardApi.test.js src/api/authApi.test.js
git add client/src/api/dashboardApi.js client/src/api/dashboardApi.test.js client/src/api/authApi.js client/src/api/authApi.test.js
git commit -m "feat: add protected dashboard client API"
```

Expected: both files pass with credential scanning still fail-closed.

---

### Task 6: Role-Specific Dashboard Presentation Components

**Files:**
- Create: `client/src/components/DashboardStatCard.test.jsx`
- Create: `client/src/components/DashboardStatCard.jsx`
- Create: `client/src/components/CustomerDashboard.test.jsx`
- Create: `client/src/components/CustomerDashboard.jsx`
- Create: `client/src/components/AdminDashboard.test.jsx`
- Create: `client/src/components/AdminDashboard.jsx`

**Interfaces:**
- `DashboardStatCard({ label, value, description })` renders one semantic statistic.
- `CustomerDashboard({ dashboard })` receives only a normalized customer dashboard.
- `AdminDashboard({ dashboard })` receives only a normalized admin dashboard.

- [ ] **Step 1: Write failing stat-card tests**

Assert an article labelled by its heading, the literal value, and optional description without relying on class-name-only assertions.

- [ ] **Step 2: Run stat-card tests RED, implement, then run GREEN**

```bash
npm test -- --run src/components/DashboardStatCard.test.jsx
```

Implement a heading/value pairing using `useId()` and an `<article aria-labelledby>`.

- [ ] **Step 3: Write failing customer component tests**

Test three counts, nearest appointment snapshot, `BookingStatusBadge`, formatted workshop date/time and duration, exact validated action link, ordered activity, generic actor label, and visible empty activity. Add no-booking/vehicle and no-booking/no-vehicle fixtures. Assert no email, username, bay, reservation, token, password, or admin-only link appears.

- [ ] **Step 4: Run customer tests RED, implement, then run GREEN**

Use existing `formatDuration`, `formatWorkshopDate`, and `formatWorkshopTimeRange`. Do not reuse `BookingTimeline`, which expects a different and more identity-rich shape.

- [ ] **Step 5: Write failing administrator component tests**

Test total/today cards, every status including zero, exactly seven ordered workload entries, labelled `<progress value max="100">`, visible percentage and `reserved of available bay-minutes`, attention link/customer/service text, and the visible empty-attention state.

- [ ] **Step 6: Run admin tests RED, implement, then run GREEN**

Use semantic sections/lists and the existing `BookingStatusBadge`. Do not add SVG, canvas, or chart dependencies.

- [ ] **Step 7: Run all component tests and commit**

```bash
npm test -- --run src/components/DashboardStatCard.test.jsx src/components/CustomerDashboard.test.jsx src/components/AdminDashboard.test.jsx
git add client/src/components/DashboardStatCard.jsx client/src/components/DashboardStatCard.test.jsx client/src/components/CustomerDashboard.jsx client/src/components/CustomerDashboard.test.jsx client/src/components/AdminDashboard.jsx client/src/components/AdminDashboard.test.jsx
git commit -m "feat: add role-specific dashboard views"
```

Expected: component tests pass with no network or auth mocks.

---

### Task 7: Dashboard Coordinator, Validation, and Protected Request Lifecycle

**Files:**
- Create: `client/src/pages/dashboardPage.test.jsx`
- Modify: `client/src/pages/DashboardPage.jsx`
- Modify: `client/src/pages/accountFlows.test.jsx`
- Modify: `client/src/App.test.jsx`
- Modify: `client/src/pages/linkFlows.test.jsx`
- Modify: `client/src/auth/bootstrapRecovery.test.jsx`

**Interfaces:**
- Consumes: `dashboardApi.get`, `handleProtectedApiError`, `CustomerDashboard`, and `AdminDashboard`.
- Retains: safe profile, exact role action order, change-password link, and single-flight logout.
- Renders the insight `AsyncState` section first, followed by the safe profile, role action navigation, and sign-out control.

- [ ] **Step 1: Write failing response-normalization tests**

Create full literal customer/admin envelopes. Accept only exact allowlisted keys, the authenticated matching role, a strict `generatedAt` instant, safe nonnegative integer counts, all seven status keys, strict ISO instants, canonical local dates, fixed `Asia/Kolkata`, 24-hex booking/vehicle/customer identifiers, `endsAt > startsAt`, duration-consistent booking intervals, local-date/start-instant correspondence, exactly seven ascending workload rows, utilization in `[0, 100]` with at most one decimal, exact action triples, exact attention kind/status relationships, and fixed href relationships. Reject extra/internal fields and return the retryable message:

```text
The dashboard response was invalid. Please try again.
```

The tests must prove malformed customer payloads cannot reach `AdminDashboard` and malformed admin payloads cannot reach `CustomerDashboard`.

- [ ] **Step 2: Run coordinator tests and verify RED**

```bash
npm test -- --run src/pages/dashboardPage.test.jsx
```

Expected: FAIL because the existing page never calls `dashboardApi.get`.

- [ ] **Step 3: Implement strict private normalization in `DashboardPage.jsx`**

Use explicit record/key/date/count helpers. Rebuild safe objects from validated scalar fields; never pass the raw response to a component. Validate customer booking/action/activity and admin workload/attention route relationships before constructing the normalized dashboard.

- [ ] **Step 4: Write failing request lifecycle tests**

Assert one initial request under React StrictMode, accessible loading, current error, Retry issuing exactly one fresh request, stale success/error ignored, unmounted settlement ignored, current 401 clears/navigates once with no error card, stale/unmounted 401 is not inspected, and repeated current 401 recovery remains single-flight.

- [ ] **Step 5: Implement the request lifecycle**

Use `mountedRef`, `generationRef`, `pendingRequestRef`, and `unauthorizedHandledRef`. Adopt the pending first request across StrictMode's development remount, set loading synchronously for each new generation, compare generation before success and failure handling, and route only current failures through `handleProtectedApiError`. Wrap normalized insight content with the existing `AsyncState` so loading is announced through `role="status"` and current errors through `role="alert"` with one Retry control.

- [ ] **Step 6: Preserve profile, links, and logout through regression tests**

Update dashboard-mounting suites with one default role-matched `dashboardApi.get` fixture. Assert DOM order: heading and insight state/content first, then profile, exact role action order, and sign-out. Keep the heading `Your account`, exact safe profile fields, no second `<main>`, and current double-click logout protection. Redirected/non-dashboard routes must make zero dashboard calls.

- [ ] **Step 7: Run coordinator/regression tests and commit**

```bash
npm test -- --run src/pages/dashboardPage.test.jsx src/pages/accountFlows.test.jsx src/App.test.jsx src/pages/linkFlows.test.jsx src/auth/bootstrapRecovery.test.jsx
git add client/src/pages/DashboardPage.jsx client/src/pages/dashboardPage.test.jsx client/src/pages/accountFlows.test.jsx client/src/App.test.jsx client/src/pages/linkFlows.test.jsx client/src/auth/bootstrapRecovery.test.jsx
git commit -m "feat: load and validate dashboard insights"
```

Expected: coordinator and existing protected-route/account regressions pass.

---

### Task 8: Responsive, Accessible Dashboard Styling

**Files:**
- Modify: `client/src/styles/index.css.test.js`
- Modify: `client/src/styles/index.css`

**Interfaces:**
- Consumes the semantic class hooks added by Task 6 and Task 7.
- Produces layouts that do not horizontally scroll at 320 CSS pixels and remain legible in forced colors/reduced motion.

- [ ] **Step 1: Write failing stylesheet behavior tests**

Read the actual CSS and assert the feature's observable stylesheet contracts: dashboard grids use `minmax(0, 1fr)`; cards/items use `min-width: 0` and wrapping; `@media (max-width: 45rem)` changes stats, workload, links, and controls to one column/full width; forced-colors rules preserve card/list borders, status boundaries, and progress context. Do not assert incidental declaration order.

- [ ] **Step 2: Run stylesheet tests and verify RED**

```bash
npm test -- --run src/styles/index.css.test.js
```

Expected: FAIL because dashboard insight selectors do not exist.

- [ ] **Step 3: Add the scoped responsive styles**

Give the dashboard a wider bounded width, responsive stat/workload grids, visible progress and percent text, safe wrapping, and scoped booking-status badge rules. Add forced-colors adjustments. Reuse the existing global reduced-motion rule and introduce no animation.

- [ ] **Step 4: Run style/component/page tests and verify GREEN**

```bash
npm test -- --run src/styles/index.css.test.js src/components/DashboardStatCard.test.jsx src/components/CustomerDashboard.test.jsx src/components/AdminDashboard.test.jsx src/pages/dashboardPage.test.jsx
```

- [ ] **Step 5: Run client lint/build and commit**

```bash
npm run lint
npm run build
git add client/src/styles/index.css client/src/styles/index.css.test.js
git commit -m "style: add accessible dashboard layouts"
```

Expected: focused tests, lint, and production build pass.

---

### Task 9: Documentation, Release Verification, and v1.1.0 Package Contract

**Files:**
- Modify: `README.md`
- Modify: `docs/api/core-booking-api.md`
- Create: `docs/acceptance/dashboard-insights-browser-checklist.md`
- Create: `docs/release/dashboard-insights-v1.1.0-verification.md`
- Modify: `server/tests/release/releaseVerifier.test.js`
- Modify: `scripts/release-verify.sh`

**Interfaces:**
- Produces: a fail-closed archive rooted at `VehicleServiceBooking-dashboard-insights-v1.1.0/`.
- Produces: external `VehicleServiceBooking-dashboard-insights-v1.1.0.zip.sha256`.
- Preserves: the recorded Core Booking v1.0.0 checksum and never overwrites a v1 archive.

- [ ] **Step 1: Write failing release-verifier behavior tests**

Run the verifier against controlled safe and adversarial staging trees. Assert the internal v1.1.0 root, required dashboard server/client/test/spec/plan/docs files, exclusion of `.git`, `.env`, `node_modules`, `dist`, coverage, logs, database files, nested archives, and suspicious public Vite variables. Assert output inside the project or an existing v1 archive path is rejected. Assert the implementation plan is tracked before release.

- [ ] **Step 2: Run verifier tests and verify RED**

```bash
(cd server && npm test -- tests/release/releaseVerifier.test.js)
```

Expected: FAIL because the verifier still emits the Core Booking v1.0.0 root and does not require dashboard files.

- [ ] **Step 3: Update verifier constants and required-file checks**

Set the internal root to `VehicleServiceBooking-dashboard-insights-v1.1.0`, require the new dashboard implementation/tests/design/plan/API/acceptance/release record, retain deterministic `zip -X` staging and internal `RELEASE-MANIFEST.sha256`, and keep every existing secret/exclusion guard.

- [ ] **Step 4: Run verifier tests and check-only GREEN**

```bash
(cd server && npm test -- tests/release/releaseVerifier.test.js)
bash scripts/release-verify.sh --check-only
```

Expected: adversarial tests pass and check-only reports the staged v1.1.0 file count without writing an archive.

- [ ] **Step 5: Write exact user/operator documentation**

Document `GET /api/dashboard`, both response envelopes, empty query, `401/400/403/503/500` behavior, customer action rules, admin workload/attention rules, no-write/privacy guarantees, demo path, and no-prediction limitation. The browser checklist must keep 320/768/1440, keyboard, screen-reader naming, forced-colors, reduced-motion, customer/admin isolation, loading/error/retry/empty/populated, and sanitized-evidence fields explicitly PENDING until a real browser run.

- [ ] **Step 6: Create the verification record structure**

Record fresh commands/results only after Task 10. Mark Docker, hosted CI, and real-browser items PASS only when executed; otherwise record exact BLOCKED/PENDING reasons. Reserve final ZIP size/count/SHA fields for post-package values.

- [ ] **Step 7: Commit release contracts and documentation**

```bash
git add README.md docs/api/core-booking-api.md docs/acceptance/dashboard-insights-browser-checklist.md docs/release/dashboard-insights-v1.1.0-verification.md docs/superpowers/plans/2026-08-30-dashboard-insights-implementation.md scripts/release-verify.sh server/tests/release/releaseVerifier.test.js
git commit -m "docs: define dashboard insights release contract"
```

---

### Task 10: Full Verification, Independent Review, and Release Archive

**Files:**
- Modify after evidence: `docs/release/dashboard-insights-v1.1.0-verification.md`
- Output outside project: `VehicleServiceBooking-dashboard-insights-v1.1.0.zip`
- Output outside project: `VehicleServiceBooking-dashboard-insights-v1.1.0.zip.sha256`

**Interfaces:**
- Consumes the complete feature branch and release verifier.
- Produces the independently checked handoff archive and exact evidence record.

- [ ] **Step 1: Run full server verification fresh**

From `server/`:

```bash
npm run test:all
npm audit --audit-level=high
```

Read the final test/suite/pass/fail/skipped/todo counts and exit codes. Do not use prior baseline output as completion evidence.

- [ ] **Step 2: Run full client verification fresh**

From `client/`:

```bash
npm test -- --run
npm run lint
npm run build
npm audit --audit-level=high
```

Read the exact test-file/test counts, generated build assets, audit result, and exit codes.

- [ ] **Step 3: Run the release check and repository hygiene checks**

From project root:

```bash
bash scripts/release-verify.sh --check-only
git status --short
git diff --check main...HEAD
```

Inspect tracked files for local `.env`, credentials, database content, build output, coverage, logs, or nested archives.

- [ ] **Step 4: Dispatch whole-branch code review and fix verified findings**

Review `git diff main...HEAD` against the design and this plan. Any Critical or Important finding receives one test-first fix and scoped re-review. Record deferred minor findings and every ruling in the progress ledger.

- [ ] **Step 5: Update the evidence record and commit it**

Write only the fresh results from Steps 1–4, retain runtime blockers honestly, and commit:

```bash
git add docs/release/dashboard-insights-v1.1.0-verification.md
git commit -m "docs: record dashboard insights verification"
```

- [ ] **Step 6: Generate the separate archive and checksum**

Use an absolute output path outside the project:

```bash
bash scripts/release-verify.sh --output /workspace/scratch/e50378ef4aea/VehicleServiceBooking-dashboard-insights-v1.1.0.zip
```

The verifier must refuse overwrite, stage the safe tree, write the internal manifest, normalize ordering/metadata, create the external checksum, and independently extract/verify the archive.

- [ ] **Step 7: Independently verify archive identity**

```bash
unzip -t /workspace/scratch/e50378ef4aea/VehicleServiceBooking-dashboard-insights-v1.1.0.zip
sha256sum -c /workspace/scratch/e50378ef4aea/VehicleServiceBooking-dashboard-insights-v1.1.0.zip.sha256
```

Extract to a fresh temporary directory, run `sha256sum -c RELEASE-MANIFEST.sha256` from the internal root, compare the sorted archive file list with the staged source list, and scan the extracted tree for excluded/sensitive artifacts.

- [ ] **Step 8: Preserve the verified source/archive boundary**

Do not modify tracked source after packaging. Treat the external `.zip.sha256` sidecar and independently observed byte size/entry count as the final archive identity, and report those facts in the handoff response. This keeps the reviewed branch clean and prevents the archive from diverging from a post-package documentation edit.

---

## Plan Self-Review Checklist

- [ ] Every design requirement maps to one of Tasks 1–10.
- [ ] Customer ownership match occurs before unwind/projection.
- [ ] Every admin status is zero-filled and workload produces exactly seven local dates.
- [ ] Workload and attention boundaries reuse the one captured instant.
- [ ] Missing schedule remains a controlled `503`.
- [ ] No mutation route, model field, index, dependency, predictive claim, or publishing integration is introduced.
- [ ] Server and client privacy are enforced by construction and tested with hostile extra fields.
- [ ] Every new production unit has a preceding observed failing test.
- [ ] Existing profile/actions/logout and protected-session behavior remain covered.
- [ ] Real-browser, Docker, and hosted CI evidence cannot be promoted without execution.
- [ ] The new release is separately named and the v1 archive/checksum identity is never overwritten.
