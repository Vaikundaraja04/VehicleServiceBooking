# Core Booking Gate 3: Administrator Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the administrator half of the approved core-booking vertical slice: service catalogue management, full workshop-schedule replacement, booking queue/detail views, and legal booking status transitions.

**Architecture:** Extend the existing admin router with authenticated, admin-only HTTP commands. Keep controllers thin: validators sanitize input, services own catalogue/schedule/booking policy and transactions, serializers control response shape, and the React administrator pages consume API adapters with the existing protected-session behavior. The schedule replacement and booking creation services serialize through the same `WorkshopSchedule` guard document so neither can commit an invalid ordering.

**Tech Stack:** Node.js/CommonJS, Express 5, Mongoose transactions on the Gate-1 replica set, `node:test`, Supertest, express-validator, Luxon; React 19, React Router 7, Vite 8, Vitest 4, Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-29-core-booking-design.md`, sections 6, 8–12, 14–15.

## Scope and prerequisites

This is Gate 3 of the four-gate Core Booking phase. Begin only after Gates 1 and 2 are green and their contracts exist:

- `Service`, `WorkshopSchedule`, and `Booking` models, initial default schedule, replica-set test/dev configuration, service seed, safe serializers, and `bookingPolicy`.
- `serviceCatalogService`, `workshopScheduleService`, `bookingService`, `bookingStateMachine`, and a transaction-safe schedule/booking guard design.
- customer booking APIs/pages and `client/src/utils/protectedApiError.js` (or the Gate-2 equivalent shared protected-error module).

Preserve without behavior changes:

- Authentication, session cookies, account recovery, administrator invitations, and their tests.
- Customer vehicle create/list/edit/archive/restore behavior, immutable registrations, and five-active-vehicle constraint.
- Existing read-only administrator vehicle route and page.
- Existing API error format and the exact 401/403 responses supplied by `authenticate` and `authorize`.

Do not add pricing, payments, technician assignment, multi-branch behavior, uploads, service deletion, booking rescheduling, direct capacity edits, or customer/admin ability to change a booking vehicle, service, start, end, bay, or reservation keys.

## Global Constraints

- Work from `server` for server commands and `client` for client commands; every command below includes its directory.
- Automated tests use only the guarded Gate-1 test database and its required replica-set configuration. Never point test execution at a development or production database.
- Write each focused test first; run it and observe the intended failure before production code; implement the smallest behavior; rerun it; then run the stated regression group.
- Every `/api/admin/*` route is exactly `authenticate -> authorize("admin") -> validation -> validateRequest -> asyncHandler(controller)`. A guest is 401 and an authenticated customer is 403.
- Invalid ObjectIds are translated before Mongoose casting to `{ "message": "Service not found" }` or `{ "message": "Booking not found" }` as applicable.
- Controllers do not decide lifecycle legality, schedule conflicts, transactions, or response projection. Those decisions live only in the designated services/utilities.
- All list queries reject unknown/repeated query keys, non-scalar values, bad pagination, invalid enums/dates/booleans, and unescaped raw regex searches. Use sanitized query data rather than `req.query`.
- Do not record a Gate 3 completion claim until every focused task, full server/client gate, and interactive admin lifecycle acceptance is green.

## Exact Gate 3 interfaces

### Administrator service catalogue

| Method | Path | Request / response |
| --- | --- | --- |
| `GET` | `/api/admin/services?page=&limit=&isActive=&search=` | `200 { services, pagination }`; name then `_id` ascending. |
| `POST` | `/api/admin/services` | Accept exactly `{ name, category, description, durationMinutes }`; `201 { service }`. |
| `PATCH` | `/api/admin/services/:id` | Accept a non-empty subset of `{ name, category, description, durationMinutes, isActive }`; `200 { service }`. |

`name` is trimmed 2–80 characters; `description` is trimmed 10–500; category is one of `maintenance`, `repair`, `inspection`, `cleaning`, `tyre`, `electrical`, `other`; duration is an integer 30–240 divisible by 30. The server derives the immutable lowercase-kebab `slug` and internal normalized `nameKey`. `slug`, `nameKey`, guard/version fields, timestamps, and unknown fields are forbidden. A normalized duplicate on create or rename is exactly:

```json
{ "message": "A service with this name already exists" }
```

Services are activated/deactivated through PATCH and are never deleted. Editing/deactivating never rewrites, cancels, reallocates, or changes the duration snapshot of an existing booking.

### Administrator schedule

| Method | Path | Request / response |
| --- | --- | --- |
| `GET` | `/api/admin/workshop-schedule` | `200 { schedule }`. |
| `PATCH` | `/api/admin/workshop-schedule` | Full replacement of editable schedule fields; `200 { schedule }`. |

PATCH accepts exactly this shape (the live request has all seven weekday records):

```json
{
  "bayCount": 2,
  "weeklyHours": [
    { "weekday": 1, "isClosed": false, "openTime": "09:00", "closeTime": "18:00" },
    { "weekday": 2, "isClosed": false, "openTime": "09:00", "closeTime": "18:00" },
    { "weekday": 3, "isClosed": false, "openTime": "09:00", "closeTime": "18:00" },
    { "weekday": 4, "isClosed": false, "openTime": "09:00", "closeTime": "18:00" },
    { "weekday": 5, "isClosed": false, "openTime": "09:00", "closeTime": "18:00" },
    { "weekday": 6, "isClosed": false, "openTime": "09:00", "closeTime": "18:00" },
    { "weekday": 7, "isClosed": true }
  ],
  "dateOverrides": [
    { "date": "2026-10-02", "isClosed": true }
  ]
}
```

`bayCount` is 1–5. Weekdays are exactly ISO 1–7 once and sorted. Open entries require grid-aligned `HH:mm` open/close values with open before close; closed entries forbid both times. Overrides have unique `YYYY-MM-DD` dates and at most 366 records. Timezone/key/slot-minute/guard/timestamp fields are server-owned and forbidden. Serialize all seven weekdays, sorted overrides, `timeZone: "Asia/Kolkata"`, `slotMinutes: 30`, `bayCount`, and `updatedAt`; never serialize stored minute values, `_id`, `__v`, `key`, or `bookingGuardVersion`.

When a proposed replacement would put a future capacity-retaining booking outside its hours/overrides or above the proposed bay count, return exactly:

```json
{ "message": "Schedule change conflicts with existing bookings" }
```

### Administrator booking queue/detail/status

| Method | Path | Request / response |
| --- | --- | --- |
| `GET` | `/api/admin/bookings?page=&limit=&status=&dateFrom=&dateTo=&search=` | `200 { bookings, pagination }`, default `startsAt ASC, _id ASC`. |
| `GET` | `/api/admin/bookings/:id` | `200 { booking }`. |
| `PATCH` | `/api/admin/bookings/:id/status` | Accept exactly `{ toStatus, reason? }`; `200 { booking }`. |

Queue search is escaped and searches vehicle registration snapshot, customer username/email, and service snapshot name. `dateFrom`/`dateTo` are inclusive workshop-local `YYYY-MM-DD` dates and are converted to an exclusive UTC upper bound; `dateFrom <= dateTo`. The standard pagination object is exactly `{ page, limit, totalItems, totalPages }`.

Administrator booking responses include safe customer identity, `bayNumber`, and history actor id/username/role; they never expose `reservedSlotKeys`. A missing or inaccessible booking is exactly `{ "message": "Booking not found" }`.

Centralized transition matrix:

| From | To | Actor / timing / reason |
| --- | --- | --- |
| `requested` | `confirmed` | Admin, strictly before `startsAt`, reason forbidden. |
| `requested` | `rejected` | Admin, reason required; allowed after missed start. |
| `requested` | `cancelled` | Admin, strictly before `startsAt`, reason required. |
| `confirmed` | `cancelled` | Admin, strictly before `startsAt`, reason required. |
| `confirmed` | `in_service` | Admin, from 30 minutes before `startsAt`, reason forbidden. |
| `confirmed` | `no_show` | Admin, at/after `startsAt`, reason forbidden and capacity released. |
| `in_service` | `completed` | Admin, reason forbidden. |

`completed`, `cancelled`, `rejected`, and `no_show` are terminal. Reasons are trimmed non-blank strings with maximum 300 characters when accepted. Stale/structurally invalid transitions return `409 { "message": "Booking status no longer permits this action" }`; timing failures return `409 { "message": "Booking action is not allowed at this time" }`. Every transition is one conditional update matching booking id and expected current status, appends exactly one actor snapshot, and unsets reservation keys atomically when capacity must be released.

## Files

### Server files modified

- `server/routes/adminRoutes.js`
- `server/controllers/adminController.js`
- `server/validators/serviceValidators.js` (create in Gate 3)
- `server/validators/scheduleValidators.js` (create in Gate 3)
- `server/validators/bookingValidators.js` (extend the Gate-2 customer validators with admin query/status validators)
- `server/middleware/requireValidServiceId.js` (create in Gate 3)
- `server/utils/serviceResponse.js` and `server/utils/bookingResponse.js` (consume unchanged; Gate 2 owns the complete `toSafeAdminBooking` contract and Gate 3 must not extend it)
- `server/services/serviceCatalogService.js` (Gate-1 service contract implementation)
- `server/services/workshopScheduleService.js` (Gate-1 service contract implementation)
- `server/services/bookingService.js` and `server/services/bookingStateMachine.js` (Gate-1 service contract implementation)

### Server tests created

- `server/tests/adminServiceRoutes.test.js`
- `server/tests/adminScheduleRoutes.test.js`
- `server/tests/adminBookingRoutes.test.js`

### Client files created

- `client/src/pages/AdminServicesPage.jsx`
- `client/src/pages/AdminSchedulePage.jsx`
- `client/src/pages/AdminBookingsPage.jsx`
- `client/src/pages/AdminBookingDetailPage.jsx`
- `client/src/pages/adminServicesPage.test.jsx`
- `client/src/pages/adminSchedulePage.test.jsx`
- `client/src/pages/adminBookingsPage.test.jsx`
- `client/src/pages/adminBookingDetailPage.test.jsx`
- `client/src/api/workshopScheduleApi.js`
- `client/src/api/workshopScheduleApi.test.js`

### Client files modified

- `client/src/api/serviceApi.js`
- `client/src/api/bookingApi.js`
- `client/src/App.jsx`
- `client/src/pages/DashboardPage.jsx`
- `client/src/components/AppShell.jsx`
- `client/src/App.test.jsx`
- `client/src/pages/accountFlows.test.jsx`

Use Gate-2 `BookingStatusBadge`, `BookingTimeline`, `BookingFilters`, `BookingSummary`, `ConfirmAction`, `AsyncState`, and `protectedApiError`; add their tests only if they were not completed in Gate 2.

## Task 1: Lock down the new administrator HTTP boundary

- [ ] Add failing authentication/authorization tests to each new admin route test file. Every GET/POST/PATCH must return the existing exact 401 response to a guest and exact 403 response to a logged-in customer.
- [ ] Add failing tests that the pre-existing `POST /api/admin/invitations` and `GET /api/admin/vehicles` behavior remains unchanged.
- [ ] Extend `server/routes/adminRoutes.js` using the existing router pattern. Do not move existing vehicle/invitation middleware.
- [ ] Add controller exports in `server/controllers/adminController.js`; each must call a service and a safe serializer only.
- [ ] Run the focused authorization baseline:

```bash
cd /workspace/scratch/29df0a03f478/vsb-audit-mqzhZB/server
npm test -- tests/adminServiceRoutes.test.js tests/adminScheduleRoutes.test.js tests/adminBookingRoutes.test.js tests/adminVehicleRoutes.test.js
```

Expected: all admin routes observe the same guest/customer/admin authorization boundary.

## Task 2: Implement and prove service catalogue operations

- [ ] In `server/tests/adminServiceRoutes.test.js`, write failing tests for exact create body acceptance, safe response keys, sorted list pagination, `isActive` and escaped search filters, and rejection of unknown/repeated query parameters.
- [ ] Add failing tests for unknown service id, malformed id, forbidden patch fields, empty patch, duration/category/name/description boundaries, and exact normalized duplicate-name 409 body.
- [ ] Create `requireValidServiceId` before the update validator. It must use `mongoose.isValidObjectId(req.params.id)` and call `next(new AppError(404, "Service not found"))` for malformed ids; test that the controller and Mongoose service layer are not reached.
- [ ] Add failing tests that deactivation/activation uses PATCH; no `DELETE /api/admin/services/:id` route exists; edits/deactivation do not alter a booking snapshot or existing booking duration.
- [ ] Implement or complete `serviceValidators` and `serviceCatalogService` so normalized name/slug/key derivation and guard increment happen in the service command, not the controller.
- [ ] Implement `listServices`, `createService`, and `updateService` controller actions. Extract list values with `matchedData(req, { locations: ["query"] })` and only pass whitelisted fields.
- [ ] Add exact routes:

```js
router.get("/services", asyncHandler(authenticate), authorize("admin"), adminServiceListValidation, validateRequest, asyncHandler(adminController.listServices));
router.post("/services", asyncHandler(authenticate), authorize("admin"), rejectUnknownFields(["name", "category", "description", "durationMinutes"]), adminServiceCreateValidation, validateRequest, asyncHandler(adminController.createService));
router.patch("/services/:id", asyncHandler(authenticate), authorize("admin"), requireValidServiceId, adminServiceUpdateUnknownFieldGuard, adminServiceUpdateValidation, validateRequest, asyncHandler(adminController.updateService));
```

- [ ] Run focused and service regressions:

```bash
cd /workspace/scratch/29df0a03f478/vsb-audit-mqzhZB/server
npm test -- tests/adminServiceRoutes.test.js tests/models/service.test.js tests/services/serviceCatalogService.test.js
```

Expected: all service catalogue tests pass, including 401/403, exact 409, safe serialization, no DELETE, and snapshot stability.

## Task 3: Implement full schedule replacement and conflict safety

- [ ] In `server/tests/adminScheduleRoutes.test.js`, add failing tests for GET default schedule, exact serialized shape, full valid replacement, seven-weekday ordering/set validation, grid-aligned/open-close validation, override uniqueness, and forbidden server-managed keys.
- [ ] Add failing integration tests for each schedule conflict: lowered bay count below future retained demand, closure/special-hours interval excluding a retained booking, and no mutation after a 409.
- [ ] Add a deliberate Promise-based race test: concurrent booking create and schedule replacement either commits one valid ordering or returns the documented conflict; it never leaves an invalid committed booking/schedule pair.
- [ ] Implement `GET/PATCH /workshop-schedule` in `adminRoutes.js` and controller actions using only the full editable document.
- [ ] Complete the Gate-1 `workshopScheduleService.replaceWorkshopSchedule()` contract with `withTransaction()`: build and validate the complete proposed document, read all capacity-retaining bookings with `reservedSlotKeys: { $exists: true }` and `endsAt: { $gt: now }`, validate each remaining interval/bay, then increment and replace the singleton. On write conflict retry the transaction; on incompatibility return the exact schedule-conflict AppError.
- [ ] Ensure schedule guard-only touches use `{ timestamps: false }`; a booking guard touch must not change schedule `updatedAt`.
- [ ] Run the focused schedule suite:

```bash
cd /workspace/scratch/29df0a03f478/vsb-audit-mqzhZB/server
npm test -- tests/adminScheduleRoutes.test.js tests/models/workshopSchedule.test.js tests/services/workshopScheduleService.test.js tests/services/bookingService.test.js
```

Expected: complete replacement validation, exact 409, and transaction-race proof pass.

## Task 4: Implement queue, detail, and lifecycle transition API

- [ ] In `server/tests/adminBookingRoutes.test.js`, write failing tests for safe queue/detail envelopes, pagination, default ordering, escaped search, composed status/date/search filters, inclusive workshop-local date bounds, and invalid/repeated query parameters.
- [ ] Add failing tests that customer-owned routes cannot read admin data and that an unknown/malformed booking id gives the safe booking 404 rather than a cast error.
- [ ] Add failing transition-matrix tests for every legal row in this plan and every terminal/stale/timing/reason violation. Assert exactly one status-history append and capacity release for rejection/cancellation/no-show.
- [ ] Reuse the Gate-2 `requireValidBookingId` middleware unchanged. Implement only `adminBookingListValidation`, `adminBookingStatusValidation`, and exact unknown-field rejection for status PATCH in this gate.
- [ ] Add exact routes:

```js
router.get("/bookings", asyncHandler(authenticate), authorize("admin"), adminBookingListValidation, validateRequest, asyncHandler(adminController.listBookings));
router.get("/bookings/:id", asyncHandler(authenticate), authorize("admin"), requireValidBookingId, asyncHandler(adminController.getBooking));
router.patch("/bookings/:id/status", asyncHandler(authenticate), authorize("admin"), requireValidBookingId, rejectUnknownFields(["toStatus", "reason"]), adminBookingStatusValidation, validateRequest, asyncHandler(adminController.changeBookingStatus));
```

- [ ] Implement controller methods by calling `bookingService.listAdminBookings`, `bookingService.getAdminBooking`, and `bookingService.transitionBooking`; serialize only through the complete `toSafeAdminBooking` created in Gate 2. Gate 3 must consume that serializer unchanged.
- [ ] Keep legal transitions exclusively in `bookingStateMachine`; `transitionBooking` performs one conditional update on expected status, history append, and capacity `$unset` where required.
- [ ] Run focused lifecycle tests:

```bash
cd /workspace/scratch/29df0a03f478/vsb-audit-mqzhZB/server
npm test -- tests/adminBookingRoutes.test.js tests/services/bookingStateMachine.test.js tests/services/bookingService.test.js
```

Expected: queue filtering, safe detail, exact errors, legal transitions, and reservation release pass.

## Task 5: Add admin API adapters and shared protected failure behavior

- [ ] Add failing API tests in `client/src/api/serviceApi.test.js` and `client/src/api/bookingApi.test.js` for all Gate 3 URLs, scalar query serialization, `encodeURIComponent` ids, exact JSON bodies, and inherited credentialed `apiRequest` behavior.
- [ ] Implement these adapter methods:

```js
serviceApi.adminList({ page = 1, limit = 20, isActive, search = "" })
serviceApi.adminCreate(payload)
serviceApi.adminUpdate(id, payload)
bookingApi.adminList({ page = 1, limit = 20, status, dateFrom, dateTo, search = "" })
bookingApi.adminGet(id)
bookingApi.adminChangeStatus(id, payload)
workshopScheduleApi.get()
workshopScheduleApi.replace(payload)
```

- [ ] Ensure every page invokes the Gate-2 `handleProtectedApiError(error, { clearSession, navigate, unauthorizedHandledRef })` only after its current-request check. Two concurrent current 401s clear/navigate once; a stale/unmounted 401 does neither.
- [ ] Do not create another page-specific 401 policy. Keep `handleVehicleApiError` compatible by delegation or re-export.
- [ ] Run focused adapter/error tests:

```bash
cd /workspace/scratch/29df0a03f478/vsb-audit-mqzhZB/client
npm test -- --run src/api/serviceApi.test.js src/api/bookingApi.test.js src/api/workshopScheduleApi.test.js src/utils/protectedApiError.test.js src/utils/vehicleErrors.test.js
```

Expected: adapter URL/body tests and the single shared 401 behavior pass.

## Task 6: Build administrator service catalogue UI

- [ ] Add failing tests in `client/src/pages/adminServicesPage.test.jsx` for loading, empty, error/retry, committed search, active/inactive filter, pagination, stale responses, current/stale 401 behavior, and only safe service field rendering.
- [ ] Add failing form tests for create, edit, client-side field errors, disabled duplicate submission, create/rename 409 ownership, and activation/deactivation confirmation.
- [ ] Implement `AdminServicesPage.jsx` using request generation guards as in `AdminVehiclesPage`. It provides a labelled create/edit form and active/inactive controls, but no delete UI.
- [ ] Use `aria-live`/`role="status"` for loading/success feedback, `role="alert"` for failures, visible labels, associated field descriptions/errors, and semantic buttons.
- [ ] Run page and API tests:

```bash
cd /workspace/scratch/29df0a03f478/vsb-audit-mqzhZB/client
npm test -- --run src/pages/adminServicesPage.test.jsx src/api/serviceApi.test.js
```

Expected: catalogue UI is retryable, accessible, stale-safe, and cannot issue a delete.

## Task 7: Build administrator schedule UI

- [ ] Add failing tests in `client/src/pages/adminSchedulePage.test.jsx` for schedule loading, seven labelled weekday rows, closed/open field behavior, bay count, add/remove override controls, client validation, pending submit disabling, retry, and current/stale 401 behavior.
- [ ] Add failing tests that an exact schedule-conflict 409 remains on the page as actionable feedback and does not overwrite the editable draft with an unrelated response.
- [ ] Implement `AdminSchedulePage.jsx` as a full editable schedule document; submit the exact full-replacement shape and never submit timezone, slot size, stored minutes, keys, timestamps, or guard fields.
- [ ] Format only user-facing local labels; retain `Asia/Kolkata` and 30-minute-grid guidance visibly.
- [ ] Run the focused UI suite:

```bash
cd /workspace/scratch/29df0a03f478/vsb-audit-mqzhZB/client
npm test -- --run src/pages/adminSchedulePage.test.jsx src/api/bookingApi.test.js
```

Expected: full schedule editing, conflict handling, accessibility, retry, and no duplicate mutation pass.

## Task 8: Build booking queue/detail/status UI and protected routes

- [ ] Add failing tests in `client/src/pages/adminBookingsPage.test.jsx` for loading/empty/error/retry, committed search, status/date filters, page reset/pagination, stale response suppression, and 401 redirect behavior.
- [ ] Add failing tests in `client/src/pages/adminBookingDetailPage.test.jsx` for safe customer/vehicle/service snapshot/timeline rendering, legal control visibility, reason prompt validation, pending state, exact 409 display, successful refresh, and hiding all direct edit/reschedule controls.
- [ ] Implement `AdminBookingsPage.jsx` with accessible filters and links to `/admin/bookings/:id`; use `BookingStatusBadge` and `BookingFilters`.
- [ ] Implement `AdminBookingDetailPage.jsx` with `BookingSummary`, `BookingTimeline`, and `ConfirmAction`. Show only controls legal for the current status and present time; server responses remain the authority.
- [ ] Add the four protected admin routes to the existing administrator group in `client/src/App.jsx`:

```jsx
<Route path="/admin/services" element={<AppShell><AdminServicesPage /></AppShell>} />
<Route path="/admin/schedule" element={<AppShell><AdminSchedulePage /></AppShell>} />
<Route path="/admin/bookings" element={<AppShell><AdminBookingsPage /></AppShell>} />
<Route path="/admin/bookings/:id" element={<AppShell><AdminBookingDetailPage /></AppShell>} />
```

- [ ] Update `DashboardPage.jsx` and role-aware `AppShell.jsx` with admin navigation for Services, Workshop schedule, and Booking queue. Preserve existing role-scoped links and add `aria-current="page"` for active navigation.
- [ ] Extend `App.test.jsx` and `accountFlows.test.jsx`: customer routes must reject an administrator, administrator routes must reject a customer, and nav must not expose the wrong role’s actions.
- [ ] Run all Gate-3 client behavior tests:

```bash
cd /workspace/scratch/29df0a03f478/vsb-audit-mqzhZB/client
npm test -- --run src/pages/adminServicesPage.test.jsx src/pages/adminSchedulePage.test.jsx src/pages/adminBookingsPage.test.jsx src/pages/adminBookingDetailPage.test.jsx src/App.test.jsx src/pages/accountFlows.test.jsx
```

Expected: all administrator pages are route-protected, responsive in structure, accessible, and preserve one shared expired-session behavior.

## Task 9: Gate 3 regression and acceptance record

- [ ] Start the Gate-1 replica-set MongoDB test environment and confirm the test database guard before full server tests.
- [ ] Run the complete server suite:

```bash
cd /workspace/scratch/29df0a03f478/vsb-audit-mqzhZB/server
npm test
```

- [ ] Run complete client gates:

```bash
cd /workspace/scratch/29df0a03f478/vsb-audit-mqzhZB/client
npm test -- --run
npm run lint
npm run build
```

- [ ] Perform browser acceptance with an administrator: create service; edit duration/description; deactivate and reactivate; read and validly replace schedule; create/locate a customer booking; confirm it before start; start it within the allowed window; complete it; separately reject a requested booking with a reason and mark a confirmed booking no-show at/after start; verify queue filters/search/pagination and timeline snapshots.
- [ ] Attempt a schedule reduction/closure that conflicts with a future retained booking and verify exact conflict feedback with no schedule mutation.
- [ ] Re-run existing customer vehicle and admin vehicle acceptance to confirm no changed route, serializer, or role behavior.
- [ ] Record command output counts, interactive results, and any intentionally deferred Gate-4 release work in this plan only after all results pass.

## Gate 3 completion checklist

- [ ] Service catalogue CRUD-minus-delete satisfies exact validation, serializer, collision, and snapshot rules.
- [ ] Schedule GET/PATCH is a full safe replacement with transaction-protected future-booking conflict checks.
- [ ] Queue/detail/status API enforces the complete administrator lifecycle and never leaks reservation keys.
- [ ] Admin pages support accessible loading/error/empty/retry/pending states and stale request protection.
- [ ] Every new protected page/API follows the one shared 401 clear-and-redirect rule.
- [ ] Full server suite, full client suite, lint, and production build pass.
- [ ] Browser acceptance proves the complete administrator lifecycle and schedule-conflict behavior.
- [ ] Gate 4 remains responsible for release evidence, CI, documentation, environment templates, and archive verification.
