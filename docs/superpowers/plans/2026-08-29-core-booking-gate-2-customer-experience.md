# Core Booking Gate 2 Customer Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the complete customer-facing service discovery, availability, booking creation, booking review, and eligible cancellation vertical slice, including its authenticated Express APIs and React experience.

**Architecture:** Wire the tested Gate-1 domain through customer-only Express routes, thin controllers, strict validators, and customer-safe serializers before building the browser flow. Client HTTP concerns stay in two small API adapters that reuse the existing credentialed `apiRequest`; pure helpers own validation/presentation/error classification, while pages own request generations, draft state, and navigation.

**Tech Stack:** Node.js/CommonJS, Express 5, express-validator, Mongoose 9, Supertest/node:test; React 19, React Router 7, Vite 8, Vitest 4, React Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-29-core-booking-design.md` (sections 9, 10, 12, 14, and Gate 2 in section 15)

## Global Constraints

- Every client command in this plan runs from `/workspace/scratch/29df0a03f478/vsb-audit-mqzhZB/client`; bare `npm test`, `npm run lint`, and `npm run build` commands assume that working directory. Server commands continue to run from the sibling `server` directory as explicitly shown.
- Gate 2 includes customer services, availability, booking create/list/detail/cancel, shared protected-API 401 handling, and customer browser acceptance only; administrator operations are Gate 3 and technician accounts are a future phase.
- Reuse `apiRequest` from `client/src/api/authApi.js`; it sends `credentials: "include"`, maps structured server errors to `ApiError`, and must remain the only fetch path for these APIs.
- Customer routes are protected by the existing `ProtectedRoute allowedRoles={["customer"]}`; a guest redirects to `/login` and an administrator redirects to `/dashboard` before feature requests start.
- The browser sends only `vehicleId`, `serviceId`, `startsAt`, and optional `notes` when creating a booking. It never sends an end time, bay, service duration, local date, reservation key, or booking status.
- The server remains authoritative for the 30-day horizon, 60-minute lead time, opening hours, duration, capacity, ownership, cancellation timing, and booking state. Client validation improves feedback but does not duplicate those policy decisions.
- Service cards show description and duration only; do not add price, payment, marketplace, rescheduling, technician, assignment, Socket.IO, or public booking behavior.
- Every protected page must handle a current 401 through one shared helper, clearing the session and navigating to `/login` exactly once. A 403 stays visible as an ordinary error; stale and unmounted requests must not redirect.
- Continue the existing accessibility baseline: native labelled controls, 44px targets, visible focus, `aria-describedby` for validation, `role="status"`/`role="alert"`, reduced-motion compatibility, and usable narrow-screen layouts.
- Do not change authentication API behavior, cookie handling, `AuthContext` safe-user shape, existing vehicle endpoint contracts, or existing `/vehicles` and `/admin/vehicles` acceptance behavior.

---

## File Structure

| Path | Action | Responsibility |
| --- | --- | --- |
| `server/routes/serviceRoutes.js` | Create | Verified-customer active service list. |
| `server/routes/bookingRoutes.js` | Create | Verified-customer availability and booking commands. |
| `server/controllers/serviceController.js` | Create | Thin active-service response handler. |
| `server/controllers/bookingController.js` | Create | Thin availability/create/list/detail/cancel handlers. |
| `server/validators/bookingValidators.js` | Create | Exact body/query/parameter customer contracts. |
| `server/middleware/requireValidBookingId.js` | Create | Safe invalid-ObjectId booking 404. |
| `server/middleware/validateRequest.js` | Modify | Add reusable unknown-query rejection without changing body validation. |
| `server/utils/serviceResponse.js` | Create | Active customer service projection. |
| `server/utils/bookingResponse.js` | Create | Customer-safe booking/history projection. |
| `server/app.js` | Modify | Mount `/api/services` and `/api/bookings`. |
| `server/tests/serviceRoutes.test.js` | Create | Service route auth and response contract. |
| `server/tests/bookingRoutes.test.js` | Create | Availability/create/list/detail/cancel integration contracts. |
| `client/src/api/serviceApi.js` | Create | Customer active-service API contract. |
| `client/src/api/bookingApi.js` | Create | Availability and customer booking API contracts. |
| `client/src/utils/protectedApiError.js` | Create | One consistent current-401 recovery path. |
| `client/src/utils/vehicleErrors.js` | Modify | Delegate current vehicle 401 handling to the shared helper. |
| `client/src/pages/VehiclesPage.jsx` | Modify | Pass a page-scoped unauthorized-once ref without changing vehicle behavior. |
| `client/src/pages/AdminVehiclesPage.jsx` | Modify | Pass the same page-scoped unauthorized-once ref. |
| `client/src/utils/bookingValidation.js` | Create | Pure draft, notes, cancel-reason, and create-payload validation. |
| `client/src/utils/bookingPresentation.js` | Create | Pure booking date/time/status/duration formatting. |
| `client/src/utils/bookingErrors.js` | Create | Booking conflict classification and safe display messages. |
| `client/src/components/AsyncState.jsx` | Create | Shared loading/error/retry rendering. |
| `client/src/components/BookingStatusBadge.jsx` | Create | Accessible customer-facing status label. |
| `client/src/components/BookingSummary.jsx` | Create | Customer-safe vehicle/service/date/status summary. |
| `client/src/components/BookingTimeline.jsx` | Create | Customer-safe status-history list. |
| `client/src/components/BookingFilters.jsx` | Create | Controlled list scope/status filters. |
| `client/src/components/ConfirmAction.jsx` | Create | Inline cancellation confirmation with optional reason. |
| `client/src/pages/BookServicePage.jsx` | Create | Four-step customer booking wizard. |
| `client/src/pages/BookingsPage.jsx` | Create | Paginated upcoming/history customer booking list. |
| `client/src/pages/BookingDetailPage.jsx` | Create | Detail, timeline, and permitted cancellation. |
| `client/src/App.jsx` | Modify | New customer role-protected routes. |
| `client/src/pages/DashboardPage.jsx` | Modify | Customer entry links to service booking and bookings. |
| `client/src/components/AppShell.jsx` | Modify | Role-aware, active customer navigation. |
| `client/src/styles/index.css` | Modify | Scoped responsive booking layouts and status styles. |
| `client/src/**/*.test.{js,jsx}` | Create/modify | Contract, route, helper, component, and page behavior coverage. |

## Shared Interfaces

```js
// API response values used by Gate 2 pages. These are documentation-only JS shapes.
// No raw owner, reservation, bay, guard, or internal database fields are rendered.
const Service = {
  id: "service-1", name: "Periodic Maintenance", slug: "periodic-maintenance",
  category: "maintenance", description: "Scheduled inspection.", durationMinutes: 90,
};
const AvailabilitySlot = {
  startsAt: "2026-09-01T03:30:00.000Z", endsAt: "2026-09-01T05:00:00.000Z", remainingCapacity: 2,
};
const Booking = {
  id: "booking-1",
  vehicle: { id: "vehicle-1", registrationNumber: "TN01AB1234", make: "Tata", model: "Nexon", year: 2025, fuelType: "electric" },
  service: { name: "Periodic Maintenance", slug: "periodic-maintenance", category: "maintenance", durationMinutes: 90 },
  startsAt: "2026-09-01T03:30:00.000Z", endsAt: "2026-09-01T05:00:00.000Z",
  localDate: "2026-09-01", timeZone: "Asia/Kolkata", status: "requested", notes: "Inspect battery",
  statusHistory: [{ fromStatus: null, toStatus: "requested", changedAt: "2026-08-29T12:00:00.000Z", actorLabel: "Customer" }],
  createdAt: "2026-08-29T12:00:00.000Z", updatedAt: "2026-08-29T12:00:00.000Z",
};
```

### Server Task A: Customer validation and safe projection boundary

**Files:**
- Modify: `server/middleware/validateRequest.js`
- Create: `server/validators/bookingValidators.js`
- Create: `server/middleware/requireValidBookingId.js`
- Create: `server/utils/serviceResponse.js`
- Create: `server/utils/bookingResponse.js`
- Create: `server/tests/validators/bookingValidators.test.js`
- Create: `server/tests/utils/bookingResponse.test.js`

**Interfaces:**
- Produces `rejectUnknownQueryFields(allowedFields)` alongside the existing body-only `rejectUnknownFields`.
- Produces `availabilityQueryValidation`, `createBookingValidation`, `listBookingsQueryValidation`, and `cancelBookingValidation`.
- Produces `toSafeService(service)`, `toSafeCustomerBooking(booking)`, and `toSafeAdminBooking(booking)`; Gate 3 consumes the admin serializer.

- [ ] **Step 1: Write failing validator and serializer tests.**

```js
assert.deepEqual(toSafeCustomerBooking(populatedBooking).statusHistory[0].actorLabel, "Customer");
assert.equal("bayNumber" in toSafeCustomerBooking(populatedBooking), false);
assert.equal("reservedSlotKeys" in toSafeCustomerBooking(populatedBooking), false);
assert.equal(toSafeAdminBooking(populatedBooking).statusHistory[0].actor.username, "admin_user");
```

Test exact create keys, strict ISO instant input, `notes` string/trim/500–501 boundary, customer reason string/trim/nonblank/300–301 boundary, scope/status/page/limit rules, repeated scalar rejection, and safe actor privacy.

- [ ] **Step 2: Run the focused tests and observe the missing-module failure.**

Run: `cd server && npm test -- tests/validators/bookingValidators.test.js tests/utils/bookingResponse.test.js`

Expected: FAIL because the Gate-2 validator and response modules do not exist.

- [ ] **Step 3: Implement strict query/body validation and the safe projections.**

```js
function rejectUnknownQueryFields(allowedFields) {
  const allowed = new Set(allowedFields);
  return (req, _res, next) => {
    const unknown = Object.keys(req.query || {}).filter((field) => !allowed.has(field));
    const repeated = Object.entries(req.query || {}).filter(([, value]) => Array.isArray(value));
    if (unknown.length === 0 && repeated.length === 0) return next();
    return next(new AppError(400, "Validation failed", [
      ...unknown.map((field) => ({ field, message: "This query field is not allowed" })),
      ...repeated.map(([field]) => ({ field, message: "This query field must be a single value" })),
    ]));
  };
}
```

`toSafeCustomerBooking` must use immutable vehicle/service snapshots, expose `vehicle.id`, translate history actors to only `Customer`/`Administrator`, and omit customer/admin ids, usernames, raw references, `bayNumber`, guards, and reservation keys. `toSafeAdminBooking` adds safe customer identity, bay number, and actor snapshot but still omits reservation keys.

- [ ] **Step 4: Run the focused tests and existing validation/security regression.**

Run: `cd server && npm test -- tests/validators/bookingValidators.test.js tests/utils/bookingResponse.test.js tests/security/app-security.test.js tests/validators/vehicleValidators.test.js`

Expected: PASS with existing body validation behavior unchanged.

- [ ] **Step 5: Record the non-Git checkpoint.**

Record the focused command and PASS count in the task log. This unpacked project has no `.git`; do not initialize one solely for checkpoints.

### Server Task B: Customer service and availability HTTP API

**Files:**
- Create: `server/routes/serviceRoutes.js`
- Create: `server/controllers/serviceController.js`
- Create: `server/routes/bookingRoutes.js` (availability route first)
- Create: `server/controllers/bookingController.js` (availability handler first)
- Modify: `server/app.js`
- Create: `server/tests/serviceRoutes.test.js`
- Create: `server/tests/bookingAvailabilityRoutes.test.js`

**Interfaces:**
- Consumes Gate-1 `serviceCatalogService.listActiveServices()` and `availabilityService.getAvailability({ serviceId, localDate, now })`.
- Produces `GET /api/services` and `GET /api/bookings/availability?serviceId=&date=` with the exact Section-9 envelopes.

- [ ] **Step 1: Write failing route tests for authorization, ordering, validation, and capacity.**

```js
await request(app).get("/api/services").expect(401);
await customerAgent.get("/api/services").expect(200).expect(({ body }) => assert.ok(Array.isArray(body.services)));
await adminAgent.get("/api/services").expect(403);
await customerAgent.get(`/api/bookings/availability?serviceId=${service.id}&date=2026-09-01`).expect(200);
```

Also assert inactive services are omitted, service order is `name/_id`, remaining capacity covers the complete duration, unknown/repeated query values fail, and no internal fields appear.

- [ ] **Step 2: Run the focused route tests and observe 404 failures.**

Run: `cd server && npm test -- tests/serviceRoutes.test.js tests/bookingAvailabilityRoutes.test.js`

Expected: FAIL because the routes are not mounted.

- [ ] **Step 3: Implement the customer-only routers and thin handlers.**

```js
function createServiceRouter() {
  const router = express.Router();
  router.use(asyncHandler(authenticate), authorize("customer"));
  router.get("/", rejectUnknownQueryFields([]), asyncHandler(serviceController.listActive));
  return router;
}

function createBookingRouter() {
  const router = express.Router();
  router.use(asyncHandler(authenticate), authorize("customer"));
  router.get("/availability", rejectUnknownQueryFields(["serviceId", "date"]), availabilityQueryValidation, validateRequest, asyncHandler(bookingController.getAvailability));
  return router;
}
```

Mount these before `notFound`: `app.use("/api/services", createServiceRouter())` and `app.use("/api/bookings", createBookingRouter())`. Controllers use `matchedData(req, { locations: ["query"] })`; they do not duplicate scheduling policy.

- [ ] **Step 4: Run focused routes plus security regression.**

Run: `cd server && npm test -- tests/serviceRoutes.test.js tests/bookingAvailabilityRoutes.test.js tests/security/app-security.test.js app.test.js`

Expected: PASS with guest 401, administrator 403, and unchanged origin/security middleware.

- [ ] **Step 5: Record the non-Git checkpoint.**

Record the command and PASS count before adding booking mutations.

### Server Task C: Customer booking create/list/detail/cancel HTTP API

**Files:**
- Modify: `server/routes/bookingRoutes.js`
- Modify: `server/controllers/bookingController.js`
- Create: `server/middleware/requireValidBookingId.js`
- Create: `server/tests/bookingRoutes.test.js`

**Interfaces:**
- Consumes Gate-1 `createBooking`, `listCustomerBookings`, `getCustomerBooking`, and `cancelBooking`.
- Produces `POST /api/bookings`, `GET /api/bookings`, `GET /api/bookings/:id`, and `PATCH /api/bookings/:id/cancel`.

- [ ] **Step 1: Write failing integration tests for the complete customer contract.**

```js
await customerAgent.post("/api/bookings").send({ vehicleId, serviceId, startsAt, notes: "Battery check" }).expect(201);
await customerAgent.get("/api/bookings?scope=upcoming&page=1&limit=20").expect(200);
await customerAgent.get(`/api/bookings/${booking.id}`).expect(200);
await customerAgent.patch(`/api/bookings/${booking.id}/cancel`).send({ reason: "Cannot attend" }).expect(200);
```

Cover exact response envelopes, another customer's safe 404, invalid ObjectId 404, archived/foreign vehicle, inactive service, unknown/managed fields, notes 500/501, reason 300/301, scope partition/order/pagination, cancellation timing/status 409, reservation release, guest 401, and admin 403.

- [ ] **Step 2: Run the focused booking route test and observe missing-route failures.**

Run: `cd server && npm test -- tests/bookingRoutes.test.js`

Expected: FAIL before mutation routes are added.

- [ ] **Step 3: Implement exact route order and thin controllers.**

```js
router.post("/", rejectUnknownFields(["vehicleId", "serviceId", "startsAt", "notes"]), createBookingValidation, validateRequest, asyncHandler(bookingController.create));
router.get("/", rejectUnknownQueryFields(["scope", "status", "page", "limit"]), listBookingsQueryValidation, validateRequest, asyncHandler(bookingController.list));
router.get("/:id", requireValidBookingId, asyncHandler(bookingController.get));
router.patch("/:id/cancel", requireValidBookingId, rejectUnknownFields(["reason"]), cancelBookingValidation, validateRequest, asyncHandler(bookingController.cancel));
```

Create responds `201 { booking }`; list responds `{ bookings, pagination }`; detail/cancel respond `{ booking }`. All objects pass through `toSafeCustomerBooking`, and controllers forward the authenticated safe User document as the actor/customer.

- [ ] **Step 4: Run customer HTTP and Gate-1 domain regression.**

Run: `cd server && npm test -- tests/serviceRoutes.test.js tests/bookingAvailabilityRoutes.test.js tests/bookingRoutes.test.js tests/services/bookingService.test.js tests/services/bookingService.race.test.js`

Expected: PASS; the public API never weakens the transaction or reservation-index guarantees.

- [ ] **Step 5: Record the non-Git checkpoint.**

Record exact server counts and proceed to the browser adapters only after the customer API is green.

### Task 1: Shared protected 401 behavior

**Files:**
- Create: `client/src/utils/protectedApiError.js`
- Create: `client/src/utils/protectedApiError.test.js`
- Modify: `client/src/utils/vehicleErrors.js`
- Modify: `client/src/utils/vehicleErrors.test.js`
- Modify: `client/src/pages/VehiclesPage.jsx`
- Modify: `client/src/pages/AdminVehiclesPage.jsx`

**Interfaces:**
- Produces: `handleProtectedApiError(error, { clearSession, navigate, unauthorizedHandledRef }) -> false | Error`.
- Preserves: `handleVehicleApiError(error, dependencies) -> false | Error` for every current vehicle caller.

- [ ] **Step 1: Write failing shared-helper tests**

```js
import { describe, expect, it, vi } from "vitest";
import { handleProtectedApiError } from "./protectedApiError";

it("clears one current 401 and safely redirects", () => {
  const clearSession = vi.fn();
  const navigate = vi.fn();
  const unauthorizedHandledRef = { current: false };
  expect(handleProtectedApiError({ status: 401 }, { clearSession, navigate, unauthorizedHandledRef })).toBe(false);
  expect(handleProtectedApiError({ status: 401 }, { clearSession, navigate, unauthorizedHandledRef })).toBe(false);
  expect(clearSession).toHaveBeenCalledTimes(1);
  expect(navigate).toHaveBeenCalledWith("/login", { replace: true });
});
it("returns non-401 errors unchanged", () => {
  const error = Object.assign(new Error("Forbidden"), { status: 403 });
  expect(handleProtectedApiError(error, { clearSession: vi.fn(), navigate: vi.fn() })).toBe(error);
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm test -- --run src/utils/protectedApiError.test.js`

Expected: FAIL because `protectedApiError.js` does not exist.

- [ ] **Step 3: Implement the helper and vehicle delegation**

```js
// client/src/utils/protectedApiError.js
export function handleProtectedApiError(error, { clearSession, navigate, unauthorizedHandledRef }) {
  if (error?.status !== 401) return error;
  if (!unauthorizedHandledRef.current) {
    unauthorizedHandledRef.current = true;
    clearSession();
    navigate("/login", { replace: true });
  }
  return false;
}

// client/src/utils/vehicleErrors.js
import { handleProtectedApiError } from "./protectedApiError";
export function handleVehicleApiError(error, dependencies) {
  return handleProtectedApiError(error, dependencies);
}
```

Each protected page creates `const unauthorizedHandledRef = useRef(false)` and passes it only after its mounted/request-generation check confirms the 401 belongs to the current request. A remounted authenticated page gets a fresh ref, while two concurrent current 401s cause one clear/navigation.

- [ ] **Step 4: Run focused regression tests**

Run: `npm test -- --run src/utils/protectedApiError.test.js src/pages/vehiclesPage.test.jsx src/pages/adminVehiclesPage.test.jsx`

Expected: PASS; current 401 tests still redirect without rendering a page alert.

- [ ] **Step 5: Record the shared-recovery checkpoint.**

Record the focused PASS count; do not initialize Git in this unpacked source solely for a checkpoint.

### Task 2: Service and booking API adapters

**Files:**
- Create: `client/src/api/serviceApi.js`
- Create: `client/src/api/serviceApi.test.js`
- Create: `client/src/api/bookingApi.js`
- Create: `client/src/api/bookingApi.test.js`

**Interfaces:**
- Produces `serviceApi.listActive()` -> `GET /services` -> `{ services }`.
- Produces `bookingApi.getAvailability({ serviceId, date })`, `create(payload)`, `list(filters)`, `get(id)`, and `cancel(id, payload)`.

- [ ] **Step 1: Write failing API-contract tests**

```js
await serviceApi.listActive();
expect(fetch).toHaveBeenCalledWith("http://localhost:5000/api/services", expect.objectContaining({ credentials: "include" }));
await bookingApi.getAvailability({ serviceId: "service/1", date: "2026-09-01" });
expect(fetch.mock.calls.at(-1)[0]).toContain("/bookings/availability?serviceId=service%2F1&date=2026-09-01");
await bookingApi.create({ vehicleId: "vehicle-1", serviceId: "service-1", startsAt: "2026-09-01T03:30:00.000Z", notes: "Inspect battery" });
expect(JSON.parse(fetch.mock.calls.at(-1)[1].body)).toEqual({ vehicleId: "vehicle-1", serviceId: "service-1", startsAt: "2026-09-01T03:30:00.000Z", notes: "Inspect battery" });
```

- [ ] **Step 2: Run the adapter tests to verify they fail**

Run: `npm test -- --run src/api/serviceApi.test.js src/api/bookingApi.test.js`

Expected: FAIL because both modules are missing.

- [ ] **Step 3: Implement exact API methods**

```js
import { apiRequest } from "./authApi";
export const serviceApi = { listActive: () => apiRequest("/services") };

function getAvailability({ serviceId, date }) {
  return apiRequest(`/bookings/availability?${new URLSearchParams({ serviceId, date })}`);
}
function create(payload) { return apiRequest("/bookings", { method: "POST", body: payload }); }
function list({ scope = "upcoming", status = "", page = 1, limit = 20 } = {}) {
  const query = new URLSearchParams({ scope, page: String(page), limit: String(limit) });
  if (status) query.set("status", status);
  return apiRequest(`/bookings?${query}`);
}
function get(id) { return apiRequest(`/bookings/${encodeURIComponent(id)}`); }
function cancel(id, payload = {}) { return apiRequest(`/bookings/${encodeURIComponent(id)}/cancel`, { method: "PATCH", body: payload }); }
export const bookingApi = { getAvailability, create, list, get, cancel };
```

- [ ] **Step 4: Add all request-body and query edge assertions, then run tests**

Run: `npm test -- --run src/api/serviceApi.test.js src/api/bookingApi.test.js`

Expected: PASS for URL encoding, defaults, optional status omission, GET/PATCH/POST method, credentials, and exact create/cancel bodies.

- [ ] **Step 5: Record the API-contract checkpoint.**

Record the focused PASS count and reviewed files; do not initialize Git solely for this unpacked project.

### Task 3: Pure booking validation, presentation, and error helpers

**Files:**
- Create: `client/src/utils/bookingValidation.js`
- Create: `client/src/utils/bookingValidation.test.js`
- Create: `client/src/utils/bookingPresentation.js`
- Create: `client/src/utils/bookingPresentation.test.js`
- Create: `client/src/utils/bookingErrors.js`
- Create: `client/src/utils/bookingErrors.test.js`

**Interfaces:**
- Produces `validateBookingDraft(draft)`, `validateNotes(notes)`, `validateCancelReason(reason)`, `toBookingCreatePayload(draft)`.
- Produces `formatWorkshopDate(localDate, timeZone)`, `formatWorkshopTimeRange(slot, timeZone)`, `formatDuration(minutes)`, `formatBookingStatus(status)`, `bookingStatusTone(status)`, `isCancellationEligible(booking)`.
- Produces `isSlotConflict(error)` and `bookingErrorMessage(error, fallback)`.

- [ ] **Step 1: Write failing pure-function examples**

```js
expect(toBookingCreatePayload({ vehicleId: "v", serviceId: "s", slot: { startsAt: "2026-09-01T03:30:00.000Z" }, notes: "  check battery  " }))
  .toEqual({ vehicleId: "v", serviceId: "s", startsAt: "2026-09-01T03:30:00.000Z", notes: "check battery" });
expect(toBookingCreatePayload({ vehicleId: "v", serviceId: "s", slot: { startsAt: "2026-09-01T03:30:00.000Z" }, notes: "  " })).not.toHaveProperty("notes");
expect(validateNotes("x".repeat(501))).toBe("Notes cannot exceed 500 characters");
expect(validateCancelReason("x".repeat(301))).toBe("Reason cannot exceed 300 characters");
expect(isSlotConflict({ status: 409, message: "That time is no longer available" })).toBe(true);
expect(isCancellationEligible({ status: "confirmed" })).toBe(true);
expect(isCancellationEligible({ status: "completed" })).toBe(false);
```

- [ ] **Step 2: Run helper tests to verify they fail**

Run: `npm test -- --run src/utils/bookingValidation.test.js src/utils/bookingPresentation.test.js src/utils/bookingErrors.test.js`

Expected: FAIL because the helper modules are missing.

- [ ] **Step 3: Implement the pure functions with only client-owned rules**

```js
export function validateNotes(value) {
  return String(value ?? "").trim().length > 500 ? "Notes cannot exceed 500 characters" : "";
}
export function validateCancelReason(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed.length > 300 ? "Reason cannot exceed 300 characters" : "";
}
export function toBookingCreatePayload({ vehicleId, serviceId, slot, notes }) {
  const payload = { vehicleId, serviceId, startsAt: slot?.startsAt };
  const trimmedNotes = String(notes ?? "").trim();
  return trimmedNotes ? { ...payload, notes: trimmedNotes } : payload;
}
export function isSlotConflict(error) {
  return error?.status === 409 && error?.message === "That time is no longer available";
}
```

`validateBookingDraft` returns `{ vehicleId, serviceId, date, slot, notes }` errors without deciding server time policy. Presentation uses `Intl.DateTimeFormat` with the response-provided time zone; `formatBookingStatus` replaces underscores with spaces and title-cases only the known display value.

- [ ] **Step 4: Run the helper suite**

Run: `npm test -- --run src/utils/bookingValidation.test.js src/utils/bookingPresentation.test.js src/utils/bookingErrors.test.js`

Expected: PASS for required selection, ISO date shape, notes 500/501, reason 300/301, optional field omission, exact conflict recognition, status tone, and timezone labels.

- [ ] **Step 5: Record the pure-helper checkpoint.**

Record the focused PASS count and reviewed files.

### Task 4: Shared booking UI primitives

**Files:**
- Create: `client/src/components/AsyncState.jsx`
- Create: `client/src/components/AsyncState.test.jsx`
- Create: `client/src/components/BookingStatusBadge.jsx`
- Create: `client/src/components/BookingStatusBadge.test.jsx`
- Create: `client/src/components/BookingSummary.jsx`
- Create: `client/src/components/BookingSummary.test.jsx`
- Create: `client/src/components/BookingTimeline.jsx`
- Create: `client/src/components/BookingTimeline.test.jsx`
- Create: `client/src/components/BookingFilters.jsx`
- Create: `client/src/components/BookingFilters.test.jsx`
- Create: `client/src/components/ConfirmAction.jsx`
- Create: `client/src/components/ConfirmAction.test.jsx`

**Interfaces:**
- `AsyncState({ status, loadingMessage, error, onRetry, children })` renders ready children, a status, or an alert plus retry.
- `BookingStatusBadge({ status })`, `BookingSummary({ booking, showNotes = true })`, `BookingTimeline({ history, timeZone })` consume only customer-safe booking fields.
- `BookingFilters({ scope, status, onScopeChange, onStatusChange })` is fully controlled.
- `ConfirmAction({ open, pending, reasonRequired, onConfirm, onDismiss })` calls `onConfirm({ reason })` only after its native form submit.

- [ ] **Step 1: Write failing structural and accessibility tests**

```jsx
render(<AsyncState status="error" error="Network failed" onRetry={retry}><p>Ready</p></AsyncState>);
expect(screen.getByRole("alert")).toHaveTextContent("Network failed");
await user.click(screen.getByRole("button", { name: "Retry" }));
expect(retry).toHaveBeenCalledTimes(1);
render(<BookingStatusBadge status="in_service" />);
expect(screen.getByText("In service")).toBeInTheDocument();
render(<ConfirmAction open reasonRequired onConfirm={onConfirm} onDismiss={onDismiss} />);
await user.click(screen.getByRole("button", { name: "Confirm cancellation" }));
expect(screen.getByRole("alert")).toHaveTextContent("Reason is required");
```

- [ ] **Step 2: Run primitive tests to verify they fail**

Run: `npm test -- --run src/components/AsyncState.test.jsx src/components/BookingStatusBadge.test.jsx src/components/BookingSummary.test.jsx src/components/BookingTimeline.test.jsx src/components/BookingFilters.test.jsx src/components/ConfirmAction.test.jsx`

Expected: FAIL because the components are missing.

- [ ] **Step 3: Implement semantic primitives**

```jsx
export function AsyncState({ status, loadingMessage = "Loading…", error, onRetry, children }) {
  if (status === "loading") return <p role="status">{loadingMessage}</p>;
  if (status === "error") return <><p role="alert">{error}</p><button type="button" onClick={onRetry}>Retry</button></>;
  return children;
}

export function BookingFilters({ scope, status, onScopeChange, onStatusChange }) {
  return <fieldset className="booking-filters"><legend>Filter bookings</legend>
    <label htmlFor="booking-scope">View</label><select id="booking-scope" value={scope} onChange={(e) => onScopeChange(e.target.value)}><option value="upcoming">Upcoming</option><option value="history">History</option><option value="all">All</option></select>
    <label htmlFor="booking-status">Status</label><select id="booking-status" value={status} onChange={(e) => onStatusChange(e.target.value)}><option value="">All statuses</option><option value="requested">Requested</option><option value="confirmed">Confirmed</option><option value="in_service">In service</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option><option value="rejected">Rejected</option><option value="no_show">No show</option></select>
  </fieldset>;
}
```

Implement `BookingSummary` as a `dl`; `BookingTimeline` as an ordered list; and `ConfirmAction` as an inline labelled form with a cancel button. Ensure optional customer reason may be blank, while an administrator-only required mode enforces non-blank input for future Gate 3 reuse.

- [ ] **Step 4: Run primitive tests**

Run: `npm test -- --run src/components/AsyncState.test.jsx src/components/BookingStatusBadge.test.jsx src/components/BookingSummary.test.jsx src/components/BookingTimeline.test.jsx src/components/BookingFilters.test.jsx src/components/ConfirmAction.test.jsx`

Expected: PASS; controls are label-addressable, error fields use `aria-describedby`, and no customer component renders bay or raw customer identity.

- [ ] **Step 5: Record the shared-component checkpoint.**

Record the focused PASS count and reviewed files.

### Task 5: Customer navigation and route guards

**Files:**
- Modify: `client/src/App.jsx`
- Modify: `client/src/components/AppShell.jsx`
- Modify: `client/src/pages/DashboardPage.jsx`
- Modify: `client/src/App.test.jsx`
- Create: `client/src/components/AppShell.test.jsx`

**Interfaces:**
- Routes are `/book-service`, `/bookings`, and `/bookings/:id`, all nested inside `ProtectedRoute allowedRoles={["customer"]}`.
- `AppShell` reads `useAuth().user` and uses `NavLink` so current links expose `aria-current="page"`.

- [ ] **Step 1: Extend failing route and nav tests**

```jsx
authenticateAsGuest(); renderAppAt("/bookings");
await waitFor(() => expect(screen.getByLabelText("Current location")).toHaveTextContent("/login"));
authenticateAs("admin"); renderAppAt("/book-service");
await waitFor(() => expect(screen.getByLabelText("Current location")).toHaveTextContent("/dashboard"));
// With an authenticated customer at /bookings, assert the My bookings link has aria-current="page".
```

- [ ] **Step 2: Run route tests to verify they fail**

Run: `npm test -- --run src/App.test.jsx src/components/AppShell.test.jsx`

Expected: FAIL because the routes and customer navigation do not exist.

- [ ] **Step 3: Add imports, guarded routes, and role-aware links**

```jsx
<Route element={<ProtectedRoute allowedRoles={["customer"]} />}>
  <Route path="/vehicles" element={<AppShell><VehiclesPage /></AppShell>} />
  <Route path="/book-service" element={<AppShell><BookServicePage /></AppShell>} />
  <Route path="/bookings" element={<AppShell><BookingsPage /></AppShell>} />
  <Route path="/bookings/:id" element={<AppShell><BookingDetailPage /></AppShell>} />
</Route>
```

`AppShell` must retain the brand link and render Dashboard, My vehicles, Book service, and My bookings only for customers. `DashboardPage` adds explicit Book a service and My bookings links in its existing customer action branch.

- [ ] **Step 4: Run route/nav regression tests**

Run: `npm test -- --run src/App.test.jsx src/components/AppShell.test.jsx src/pages/linkFlows.test.jsx`

Expected: PASS; only customer visits load booking pages, active links are announced, and existing account/invitation routes remain intact.

- [ ] **Step 5: Record the navigation checkpoint.**

Record the focused PASS count and route-guard review.

### Task 6: Four-step booking wizard

**Files:**
- Create: `client/src/pages/BookServicePage.jsx`
- Create: `client/src/pages/bookServicePage.test.jsx`
- Modify: `client/src/styles/index.css`

**Interfaces:**
- Consumes `vehicleApi.list({ status: "active" })`, `serviceApi.listActive()`, `bookingApi.getAvailability({ serviceId, date })`, `bookingApi.create(payload)`, shared helpers/components, `useAuth().clearSession`, and `useNavigate()`.
- Produces a `POST /bookings` success navigation to `/bookings/:id` using returned `booking.id`.

- [ ] **Step 1: Write failing wizard tests**

```jsx
vehicleApi.list.mockResolvedValue({ vehicles: [activeVehicle] });
serviceApi.listActive.mockResolvedValue({ services: [service] });
bookingApi.getAvailability.mockResolvedValue({ date: "2026-09-01", timeZone: "Asia/Kolkata", service, slots: [slot] });
renderBookServicePage();
await user.click(screen.getByRole("button", { name: /select TN01AB1234/i }));
await user.click(screen.getByRole("button", { name: /next/i }));
await user.click(screen.getByRole("button", { name: /select Periodic Maintenance/i }));
await user.type(screen.getByLabelText("Appointment date"), "2026-09-01");
expect(bookingApi.getAvailability).toHaveBeenCalledWith({ serviceId: "service-1", date: "2026-09-01" });
```

Add separate cases for: no active vehicles links to `/vehicles`; service description and duration with no price; closed/no-slots text; retry; slot start/end/capacity label; review summary; exact create payload; disabled duplicate confirmation; conflict 409 refetch plus alert; and current/stale/unmounted 401 behavior.

- [ ] **Step 2: Run the wizard test to verify it fails**

Run: `npm test -- --run src/pages/bookServicePage.test.jsx`

Expected: FAIL because `BookServicePage` is missing.

- [ ] **Step 3: Implement the four named wizard states**

```jsx
const INITIAL_DRAFT = { vehicleId: "", vehicle: null, serviceId: "", service: null, date: "", slot: null, notes: "" };
// step 1 Vehicle: list only active owned vehicles.
// step 2 Service: cards show name, category, description, duration.
// step 3 Time: date input then availability slot buttons.
// step 4 Review: BookingSummary plus labelled notes textarea and confirm button.
```

Use a monotonic request generation/ref plus mounted guard for each asynchronous load. Invoke `handleProtectedApiError` only after confirming the response is current. The slot-conflict catch calls availability loading again for the still-selected `{ serviceId, date }`, clears the selected slot, and announces: `That time is no longer available. Choose another available time.` Focus each step heading after moving forward/back and the first missing control when validation blocks progress.

- [ ] **Step 4: Add scoped responsive CSS and run wizard tests**

```css
.booking-wizard { max-width: 60rem; margin: 0 auto; }
.booking-choice-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); gap: 1rem; }
.booking-slot-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: .75rem; }
.booking-step-actions { display: flex; flex-wrap: wrap; gap: .75rem; }
@media (max-width: 45rem) { .booking-step-actions > button { width: 100%; } }
```

Run: `npm test -- --run src/pages/bookServicePage.test.jsx`

Expected: PASS for all four steps, availability, retry/conflict, one pending mutation, accessibility labels, and session-expiry protections.

- [ ] **Step 5: Record the booking-wizard checkpoint.**

Record the focused PASS count and browser-state review.

### Task 7: Customer booking list

**Files:**
- Create: `client/src/pages/BookingsPage.jsx`
- Create: `client/src/pages/bookingsPage.test.jsx`
- Modify: `client/src/styles/index.css`

**Interfaces:**
- Consumes `bookingApi.list({ scope, status, page, limit: 20 })`, `BookingFilters`, `BookingStatusBadge`, `AsyncState`, and protected error helper.
- Renders customer booking cards linking to `/bookings/:id`; consumes pagination `{ page, limit, totalItems, totalPages }`.

- [ ] **Step 1: Write failing list tests**

```jsx
bookingApi.list.mockResolvedValue({ bookings: [booking], pagination: { page: 1, limit: 20, totalItems: 1, totalPages: 1 } });
renderBookingsPage();
await waitFor(() => expect(bookingApi.list).toHaveBeenCalledWith({ scope: "upcoming", status: "", page: 1, limit: 20 }));
await user.selectOptions(screen.getByLabelText("View"), "history");
expect(bookingApi.list).toHaveBeenLastCalledWith({ scope: "history", status: "", page: 1, limit: 20 });
expect(screen.getByRole("link", { name: /Periodic Maintenance/i })).toHaveAttribute("href", "/bookings/booking-1");
```

- [ ] **Step 2: Run the list test to verify it fails**

Run: `npm test -- --run src/pages/bookingsPage.test.jsx`

Expected: FAIL because `BookingsPage` is missing.

- [ ] **Step 3: Implement controlled filters, pagination, and request generations**

```jsx
const [filters, setFilters] = useState({ scope: "upcoming", status: "", page: 1, limit: 20 });
function updateFilter(name, value) { setFilters((current) => ({ ...current, [name]: value, page: 1 })); }
```

Use `AsyncState` for loading/error/retry. Present each result as a card containing `BookingStatusBadge`, service/vehicle summary, and detail link. Empty copy must distinguish upcoming (`No upcoming bookings`), history (`No booking history`), and a selected status (`No bookings match these filters`). Disable pagination at the bounds. Prevent an older success or 401 from replacing/redirecting after a newer request or unmount.

- [ ] **Step 4: Run list and routing tests**

Run: `npm test -- --run src/pages/bookingsPage.test.jsx src/App.test.jsx`

Expected: PASS for defaults, status/scope page reset, empty/loading/retry, next/previous, stale generations, links, and 401 behavior.

- [ ] **Step 5: Record the booking-list checkpoint.**

Record the focused PASS count and pagination review.

### Task 8: Booking detail and cancellation

**Files:**
- Create: `client/src/pages/BookingDetailPage.jsx`
- Create: `client/src/pages/bookingDetailPage.test.jsx`
- Modify: `client/src/styles/index.css`

**Interfaces:**
- Consumes `useParams().id`, `bookingApi.get(id)`, `bookingApi.cancel(id, { reason? })`, `BookingSummary`, `BookingTimeline`, `ConfirmAction`, `isCancellationEligible`, and protected error helper.
- On successful cancellation, replaces local booking state with the returned `{ booking }` response; does not re-fetch the list.

- [ ] **Step 1: Write failing detail/cancel tests**

```jsx
bookingApi.get.mockResolvedValue({ booking });
renderBookingDetailPage("/bookings/booking-1");
expect(await screen.findByText("Periodic Maintenance")).toBeInTheDocument();
await user.click(screen.getByRole("button", { name: "Cancel booking" }));
await user.type(screen.getByLabelText("Cancellation reason (optional)"), "  cannot attend  ");
await user.click(screen.getByRole("button", { name: "Confirm cancellation" }));
expect(bookingApi.cancel).toHaveBeenCalledWith("booking-1", { reason: "cannot attend" });
```

Include tests that terminal statuses omit cancellation controls; cancel dismissal sends no request; a blank optional reason produces `{}`; 409 leaves the detail visible with the server message; only safe customer history fields render; and all current/stale/unmounted 401 cases follow the helper contract.

- [ ] **Step 2: Run detail tests to verify they fail**

Run: `npm test -- --run src/pages/bookingDetailPage.test.jsx`

Expected: FAIL because `BookingDetailPage` is missing.

- [ ] **Step 3: Implement detail state and inline cancellation**

```jsx
const { id } = useParams();
const [booking, setBooking] = useState(null);
const [confirmingCancel, setConfirmingCancel] = useState(false);
async function cancelBooking({ reason }) {
  const response = await bookingApi.cancel(id, reason ? { reason } : {});
  setBooking(response.booking);
  setConfirmingCancel(false);
}
```

Load by id with a mounted/request-generation guard. Show `BookingSummary`, `BookingTimeline`, and `ConfirmAction` only when `isCancellationEligible(booking)` is true. Do not predict “future” locally: an API 409 is authoritative and its exact message is shown in an alert.

- [ ] **Step 4: Run detail and component regressions**

Run: `npm test -- --run src/pages/bookingDetailPage.test.jsx src/components/BookingSummary.test.jsx src/components/BookingTimeline.test.jsx src/components/ConfirmAction.test.jsx`

Expected: PASS for detail loading/retry, safe timeline, eligibility, optional reason, pending state, updated booking, conflict, and current-only 401 redirects.

- [ ] **Step 5: Record the booking-detail checkpoint.**

Record the focused PASS count and cancellation review.

### Task 9: Gate 2 integration and acceptance evidence

**Files:**
- Modify: `client/README.md`
- Modify: `docs/superpowers/plans/2026-08-29-core-booking-gate-2-customer-experience.md` (check completed steps and record command results only)

**Interfaces:**
- Verifies the completed public client routes: `/book-service`, `/bookings`, `/bookings/:id`.
- Verifies the established client scripts: test, lint, build, and audit.

- [x] **Step 1: Add focused route and protected-API integration tests before final verification**

```jsx
it("redirects a customer to login exactly once after a current booking mutation 401", async () => {
  bookingApi.create.mockRejectedValue(Object.assign(new Error("Authentication required"), { status: 401 }));
  // Drive the wizard through review and confirm, then assert clearSession once and /login.
});
```

- [x] **Step 2: Run the entire server suite against the guarded replica-set test database.**

Run: `cd server && npm test`

Expected: PASS with Gate-1 domain/race and all customer route tests included; no existing auth/vehicle regression.

- [x] **Step 3: Run the entire client suite**

Run: `npm test -- --run`

Expected: PASS; this includes existing authentication, route, API, and vehicle tests as well as every Gate 2 test.

- [x] **Step 4: Run static and production verification**

Run: `npm run lint && npm run build && npm audit --audit-level=high`

Expected: lint exits 0, Vite writes `dist/`, and audit reports no high or critical advisory. Resolve failures before continuing; do not suppress lint rules or audit output.

- [ ] **Step 5: Perform browser acceptance against the Gate-2 customer API**

```text
1. Sign in as a verified customer with one active vehicle.
2. Open Book service, choose vehicle and active service, choose a workshop-local date/slot, add optional notes, review, and confirm.
3. Confirm the detail page shows customer-safe vehicle/service snapshots, date/time/duration, requested status, and timeline.
4. Open My bookings; confirm upcoming card/detail link and status appear.
5. Cancel a future requested booking; confirm status becomes cancelled and history updates.
6. Repeat creation with a slot claimed by a concurrent request; confirm availability refreshes and the conflict alert appears.
7. Expire the session before list/detail/create/cancel; confirm each current request returns to `/login` once without an in-page error.
8. Repeat the wizard, list, and detail at a narrow viewport and with keyboard-only navigation.
```

- [ ] **Step 6: Update route documentation and record Gate-2 evidence.**

Store sanitized commands/counts in the project documentation; the final versioned ZIP is the non-Git release checkpoint.

#### Task 9 result evidence — 2026-08-29

- Reviewed audit corrections are closed for bounded booking-list pages, schedule-owned timezone/DST availability calculations, wizard duration coherence and live empty states, protected-401 handling in the older password/invitation flows, fail-closed malformed booking-list responses, and detail ObjectId/focus handling. The exact create/cancel payloads, route guards, privacy boundaries, conflict handling, and stale/unmounted protections remain covered.
- Fresh guarded full-server verification passed: `cd server && npm test` exited 0 with 483/483 tests across 16 suites and zero failed, skipped, or todo; duration 182479 ms. The package script used the one-member `rs0` test wrapper and no development database URI.
- Fresh full-client verification passed: `npm test -- --run` exited 0 with 584/584 tests in 32/32 files, zero skipped, in 30.08 s. `npm run lint` exited 0. `npm audit --audit-level=high` exited 0 with `found 0 vulnerabilities`. `npm run build` exited 0 with Vite 8.2.2 transforming 67 modules and emitting exactly `index.html`, one CSS asset, and `assets/index-DOu30Myq.js`.
- Static review found one production `fetch` boundary, in `authApi.apiRequest`; every Gate 2 adapter delegates to it. No Gate 2 customer production source consumes raw identity, bay/reservation/guard/ref/snapshot/actor identifiers, `_id`, or `__v`, and no price, payment, technician, reschedule, real-time, or predictive feature was added.
- Browser acceptance remains **PENDING**. Cloud Chrome blocks localhost with `ERR_BLOCKED_BY_CLIENT`, and this executor has no local browser, Playwright, Docker, or viewport control. No screenshot or runtime observation is claimed.
- Route/setup documentation and sanitized evidence were recorded. The final independent broad review accepted the automated/static vertical slice with 0 Critical, 0 Important, and 0 Minor findings and approved Gate 3 entry with the browser blocker carried forward. Overall Gate 2 remains incomplete until the pending browser matrix is executed. Step 6 remains unchecked because its final-ZIP wording is not a Gate 2 deliverable: Gate 4 owns Docker/API-container verification and release ZIP packaging. No final ZIP was created.

## Spec Coverage Review

- Customer service catalogue, availability, exact create request, list/detail/cancel server routes: Server Tasks A–C; browser adapters/pages: Tasks 2 and 6–8.
- Four wizard requirements including active vehicles, duration/description, local date, slot capacity, pending state, 409 refresh, review, and accessibility: Task 6.
- Shared 401 implementation and vehicle regression preservation: Task 1; page-level current-request checks: Tasks 6–8.
- Shared components named in the specification: Task 4.
- Role routes and role-aware active navigation: Task 5.
- Server route/domain regression plus client test/lint/build quality gate: Server Tasks A–C and Task 9.
- Administrator catalogue/schedule/queue/status views and technician features are deliberately excluded because the approved design assigns them to Gate 3 and a future phase respectively.

## Placeholder and Interface Review

- The plan contains no deferred implementation markers. Every new module, route, command, and public function is named above.
- `bookingApi`, `serviceApi`, `handleProtectedApiError`, helper names, component props, and page paths are defined before a later task consumes them.
- The only browser-derived scheduling value submitted is `slot.startsAt`; all other scheduling and lifecycle decisions stay on the API defined by the approved spec.
