# Core booking API

Base URL: `http://localhost:5000/api`

All endpoints return JSON. Authentication uses the `HttpOnly` `vsb_auth` cookie, so browser calls send credentials. Customer routes reject guests with `401` and administrators with `403`; `/admin/*` routes reject guests with `401` and customers with `403`. Routes that declare query input reject unknown keys and repeated scalar values. Mutation/detail clients must send only the documented path/body input; not every such route installs an unknown-query guard.

## Shared contracts

- Workshop zone: `Asia/Kolkata`
- Grid: 30 minutes; service duration: 30–240 minutes in whole-grid increments
- Availability horizon: today through 29 days ahead; booking lead time: at least 60 minutes
- Statuses: `requested`, `confirmed`, `in_service`, `completed`, `cancelled`, `rejected`, `no_show`
- Pagination: `{ "page", "limit", "totalItems", "totalPages" }`; page defaults to 1 and is capped at 10,000; limit defaults to 20 and is capped at 100
- Validation error: `400 { "message": "Validation failed", "errors": [{ "field", "message" }] }`
- Invalid/missing/foreign booking identifiers deliberately share `404 { "message": "Booking not found" }`

Common authentication/authorization envelopes:

- Missing cookie: `401 { "message": "Authentication required" }`
- Invalid, expired, or revoked cookie: `401 { "message": "Authentication is invalid or expired" }`
- Inactive account: `403 { "message": "Account is inactive" }`
- Unverified account: `403 { "message": "Email verification is required" }`
- Wrong role: `403 { "message": "You do not have permission for this action" }`

Customer booking history exposes only `actorLabel: "Customer" | "Administrator"`. It never exposes an administrator id or username. Administrator booking responses additionally include safe customer identity, bay number, and history actor snapshots. Password hashes, tokens, guards, MongoDB internals, and reservation keys are never serialized.

## Dashboard Insights v1.1.0

| Method and path | Role | Input | Success | Documented outcomes |
| --- | --- | --- | --- | --- |
| `GET /dashboard` (`GET /api/dashboard`) | Customer or administrator | No body and no query parameters | `200 { dashboard }` with the current database role's exact envelope | `400`, `401`, `403`, `503`, `500` |

Authentication and current-role authorization run before the empty-query guard. A guest request to `/api/dashboard?bad=1` therefore returns the authentication `401`, not query validation `400`. An authenticated request containing any query key—including unknown, repeated, bracketed, or otherwise non-scalar input—returns the existing structured validation envelope. For example, `?bad=1`, `?bad=1&bad=2`, and `?bad[nested]=1` return:

```json
{
  "message": "Validation failed",
  "errors": [
    { "field": "bad", "message": "This query field is not allowed" }
  ]
}
```

For bracketed input, the reported field is the received field name, such as `bad[nested]`. The only valid query is empty: call `GET /api/dashboard` without query parameters. The route takes no client-supplied role, time, filters, pagination, or body.

### Customer dashboard envelope

```json
{
  "dashboard": {
    "role": "customer",
    "generatedAt": "2026-08-30T08:00:00.000Z",
    "summary": {
      "activeVehicles": 2,
      "upcomingBookings": 1,
      "completedBookings": 3
    },
    "nextBooking": {
      "id": "64f000000000000000000001",
      "vehicle": {
        "id": "64f000000000000000000002",
        "registrationNumber": "TN01AB1234",
        "make": "Tata",
        "model": "Nexon",
        "year": 2024,
        "fuelType": "petrol"
      },
      "service": {
        "name": "Full service",
        "slug": "full-service",
        "category": "maintenance",
        "durationMinutes": 90
      },
      "startsAt": "2026-08-31T04:30:00.000Z",
      "endsAt": "2026-08-31T06:00:00.000Z",
      "localDate": "2026-08-31",
      "timeZone": "Asia/Kolkata",
      "status": "confirmed"
    },
    "action": {
      "kind": "view_booking",
      "href": "/bookings/64f000000000000000000001",
      "label": "View your next appointment"
    },
    "recentActivity": [
      {
        "bookingId": "64f000000000000000000001",
        "toStatus": "confirmed",
        "changedAt": "2026-08-30T07:00:00.000Z",
        "actorLabel": "Administrator",
        "reason": null
      }
    ]
  }
}
```

`activeVehicles` counts the signed-in customer's active vehicles. `upcomingBookings` counts that customer's unended `requested`/`confirmed` bookings plus every `in_service` booking; `completedBookings` counts completed bookings. `nextBooking` is the earliest item under the same upcoming rule and is `null` when absent. `recentActivity` contains at most the five newest safe status-history entries across that customer's bookings.

The customer action is derived on the server in this exact priority:

1. When `nextBooking` exists: `{ "kind": "view_booking", "href": "/bookings/<booking-id>", "label": "View your next appointment" }`.
2. Otherwise, when `activeVehicles > 0`: `{ "kind": "book_service", "href": "/book-service", "label": "Book a service" }`.
3. Otherwise: `{ "kind": "add_vehicle", "href": "/vehicles", "label": "Add your first vehicle" }`.

This action is navigation guidance, not a maintenance prediction. The application has no mileage, diagnostic, telematics, or manufacturer-interval input and never claims that a vehicle is due for service.

### Administrator dashboard envelope

```json
{
  "dashboard": {
    "role": "admin",
    "generatedAt": "2026-08-30T08:00:00.000Z",
    "summary": {
      "totalBookings": 18,
      "todayAppointments": 4,
      "byStatus": {
        "requested": 3,
        "confirmed": 5,
        "in_service": 1,
        "completed": 6,
        "cancelled": 1,
        "rejected": 1,
        "no_show": 1
      }
    },
    "workload": [
      {
        "date": "2026-08-30",
        "appointmentCount": 4,
        "reservedMinutes": 240,
        "availableBayMinutes": 960,
        "utilizationPercent": 25
      },
      {
        "date": "2026-08-31",
        "appointmentCount": 1,
        "reservedMinutes": 90,
        "availableBayMinutes": 960,
        "utilizationPercent": 9.4
      },
      {
        "date": "2026-09-01",
        "appointmentCount": 0,
        "reservedMinutes": 0,
        "availableBayMinutes": 960,
        "utilizationPercent": 0
      },
      {
        "date": "2026-09-02",
        "appointmentCount": 0,
        "reservedMinutes": 0,
        "availableBayMinutes": 960,
        "utilizationPercent": 0
      },
      {
        "date": "2026-09-03",
        "appointmentCount": 0,
        "reservedMinutes": 0,
        "availableBayMinutes": 960,
        "utilizationPercent": 0
      },
      {
        "date": "2026-09-04",
        "appointmentCount": 0,
        "reservedMinutes": 0,
        "availableBayMinutes": 960,
        "utilizationPercent": 0
      },
      {
        "date": "2026-09-05",
        "appointmentCount": 0,
        "reservedMinutes": 0,
        "availableBayMinutes": 0,
        "utilizationPercent": 0
      }
    ],
    "attention": [
      {
        "kind": "overdue_confirmed",
        "bookingId": "64f000000000000000000001",
        "startsAt": "2026-08-30T07:30:00.000Z",
        "status": "confirmed",
        "customer": {
          "id": "64f000000000000000000003",
          "username": "demo_customer",
          "email": "demo@example.invalid"
        },
        "vehicleRegistrationNumber": "TN01AB1234",
        "serviceName": "Full service",
        "href": "/admin/bookings/64f000000000000000000001"
      }
    ]
  }
}
```

`totalBookings` counts all bookings. `byStatus` always contains all seven statuses in the shown order and zero-fills missing statuses. `todayAppointments` and each workload `appointmentCount` use the same live-workload predicate: `requested`, `confirmed`, or `in_service` with `reservedSlotKeys` present. Completed, cancelled, rejected, and no-show bookings are excluded from workload even if historical reservation data remains stored.

`workload` always contains exactly seven ascending workshop-local dates beginning with the local date of `generatedAt`. Each live booking contributes its immutable `serviceSnapshot.durationMinutes` once. Available bay-minutes use a matching date override when present, otherwise that ISO weekday's hours, multiplied by `bayCount`; closed dates contribute zero. Utilization is zero when capacity is zero, otherwise `reservedMinutes / availableBayMinutes × 100`, rounded to one decimal and capped at 100. It is a current bounded capacity summary, not a forecast or staffing recommendation.

`attention` contains at most five read-only items in this exact priority:

1. `overdue_confirmed`: `confirmed` with `startsAt` at or before the captured instant.
2. `requested_soon`: `requested` with `startsAt` from the captured instant through the next 24 hours, inclusive.
3. `in_service`: every `in_service` booking.

Within each priority, items sort by `startsAt` and then booking identifier. Reading the dashboard never confirms, starts, completes, cancels, rejects, or otherwise mutates a booking.

### Dashboard errors, privacy, and method boundary

- Missing cookie: `401 { "message": "Authentication required" }`.
- Invalid, expired, or revoked cookie: `401 { "message": "Authentication is invalid or expired" }`.
- Inactive account: `403 { "message": "Account is inactive" }`.
- Unverified account: `403 { "message": "Email verification is required" }`.
- A current role outside the permitted customer/administrator boundary: `403 { "message": "You do not have permission for this action" }`.
- Any query field after successful authentication/authorization: structured `400` as shown above.
- Administrator dashboard with no workshop schedule: `503 { "message": "Workshop schedule is unavailable" }`; capacity is never invented. The customer projection does not need the workshop schedule.
- Unexpected database/service failure: `500 { "message": "Internal server error" }`; internal error details and stacks are not returned.

The current user is reloaded from the database before projection selection, so a stale cookie role cannot request the other role's envelope. Customer aggregation matches the authenticated customer before unwind/projection and exposes no customer identity, administrator identity, bay number, raw references, reservation keys, guards, credentials, cookie, or token fields. Administrator attention exposes only customer `id`, `username`, and `email` plus the documented booking snapshot fields; it omits actor history, bay numbers, reservation keys, guards, credentials, cookies, and tokens.

There is no dashboard `POST`, `PATCH`, `PUT`, or `DELETE` route. Those methods return `404 { "message": "Route not found" }` and perform no dashboard work. `generatedAt`, all counts, seven workload boundaries, and the 24-hour attention window derive from one server-captured instant per successful request.

## Customer service and availability

| Method and path | Role | Input | Success | Documented outcomes |
| --- | --- | --- | --- | --- |
| `GET /services` | Customer | No query parameters | `200 { services }`; active services ordered by name then id | `400`, `401`, `403` |
| `GET /bookings/availability?serviceId=<id>&date=YYYY-MM-DD` | Customer | Active service id and real workshop-local date | `200 { date, timeZone, service, slots }` | `400`, `401`, `403`, `404`, `409`, `503` |

Each slot contains `startsAt`, `endsAt`, and `remainingCapacity`. Capacity is available for the service's complete half-open interval, not only its first 30-minute cell. Closed days and fully occupied intervals return an empty `slots` array. Invalid/inactive service ids return safe `404`; missing schedule returns `503 { "message": "Workshop schedule is unavailable" }`; dates outside policy return `409 { "message": "Booking action is not allowed at this time" }`.

## Customer bookings

| Method and path | Role | Input | Success | Documented outcomes |
| --- | --- | --- | --- | --- |
| `POST /bookings` | Customer | `{ vehicleId, serviceId, startsAt, notes? }` | `201 { booking }` in `requested` state | `400`, `401`, `403`, `404`, `409`, `503` |
| `GET /bookings` | Customer | `scope=upcoming|history|all`, optional `status`, `page`, `limit` | `200 { bookings, pagination }` for the signed-in customer only | `400`, `401`, `403` |
| `GET /bookings/:id` | Customer | Owned booking id | `200 { booking }` | `401`, `403`, `404` |
| `PATCH /bookings/:id/cancel` | Customer | `{ reason? }` | `200 { booking }` in `cancelled` state | `400`, `401`, `403`, `404`, `409` |

`startsAt` must be a timezone-bearing ISO instant offered by availability. Notes are trimmed and at most 500 characters. The vehicle must be active and owned by the customer. Booking creation records immutable vehicle/service snapshots and chooses the first free bay atomically inside a MongoDB transaction.

List scope rules:

- `upcoming` (default): requested/confirmed bookings whose interval has not ended, plus every `in_service` booking regardless of interval end
- `history`: terminal bookings plus expired `requested`/`confirmed` bookings; `in_service` never moves to history until an administrator completes it
- `all`: every owned booking

Upcoming is ordered oldest first; history/all newest first. The `status` filter composes with scope.

Cancellation is permitted only for an owning customer with a `requested` or `confirmed` booking strictly before its start. Optional reason must be trimmed, non-empty, and at most 300 characters. Foreign ids remain indistinguishable from absent ids.

Important outcomes:

- `404 { "message": "Vehicle not found" }`
- `404 { "message": "Service not found" }`
- `409 { "message": "This service is currently unavailable" }`
- `409 { "message": "That time is no longer available" }`
- `409 { "message": "Booking status no longer permits this action" }`
- `409 { "message": "Booking action is not allowed at this time" }`

## Administrator service catalogue

| Method and path | Role | Input | Success | Documented outcomes |
| --- | --- | --- | --- | --- |
| `GET /admin/services` | Administrator | Optional `page`, `limit`, `isActive=true|false`, `search` | `200 { services, pagination }` | `400`, `401`, `403` |
| `POST /admin/services` | Administrator | `{ name, category, description, durationMinutes }` | `201 { service }` | `400`, `401`, `403`, `409` |
| `PATCH /admin/services/:id` | Administrator | Non-empty subset of `{ name, category, description, durationMinutes, isActive }` | `200 { service }` | `400`, `401`, `403`, `404`, `409` |

Categories are `maintenance`, `repair`, `inspection`, `cleaning`, `tyre`, `electrical`, and `other`. Name is normalized and must be 2–80 characters with at least one ASCII letter/number; description is 10–500 characters. The slug is server-derived and cannot be patched. Duplicate normalized names return `409 { "message": "A service with this name already exists" }`; invalid/missing ids return `404 { "message": "Service not found" }`.

Deactivating a service hides it from customer discovery and prevents new bookings; existing booking snapshots remain unchanged.

## Administrator workshop schedule

| Method and path | Role | Input | Success | Documented outcomes |
| --- | --- | --- | --- | --- |
| `GET /admin/workshop-schedule` | Administrator | No query parameters | `200 { schedule }` | `400`, `401`, `403`, `503` |
| `PATCH /admin/workshop-schedule` | Administrator | Full `{ bayCount, weeklyHours, dateOverrides }` replacement | `200 { schedule }` | `400`, `401`, `403`, `409`, `503` |

`bayCount` is 1–5. `weeklyHours` contains exactly weekdays 1 through 7 in order. Open entries require grid-aligned `openTime` and `closeTime`; closed entries contain only `weekday` and `isClosed`. Up to 366 unique date overrides use the same open/closed shape with `date` instead of `weekday`.

The response includes the fixed `timeZone`, `slotMinutes`, all seven sorted weekdays, sorted overrides, and `updatedAt`. A replacement that would invalidate any retained future capacity returns exact `409 { "message": "Schedule change conflicts with existing bookings" }`; it never moves, cancels, or reassigns a booking. Missing schedule returns `503 { "message": "Workshop schedule is unavailable" }`.

## Administrator booking queue

| Method and path | Role | Input | Success | Documented outcomes |
| --- | --- | --- | --- | --- |
| `GET /admin/bookings` | Administrator | Optional `page`, `limit`, `status`, `dateFrom`, `dateTo`, `search` | `200 { bookings, pagination }` | `400`, `401`, `403` |
| `GET /admin/bookings/:id` | Administrator | Booking id | `200 { booking }` | `400`, `401`, `403`, `404` |
| `PATCH /admin/bookings/:id/status` | Administrator | `{ toStatus, reason? }` | `200 { booking }` | `400`, `401`, `403`, `404`, `409` |

Dates are inclusive workshop-local `YYYY-MM-DD` values. Search is trimmed, escaped, at most 100 characters, and matches vehicle registration snapshot, username, email, or service snapshot name. Results are ordered by start then id ascending.

Legal administrator transitions:

| From | To | Timing/reason rule |
| --- | --- | --- |
| `requested` | `confirmed` | Before start; reason forbidden |
| `requested` | `rejected` | Any time; reason required |
| `requested` | `cancelled` | Before start; reason required |
| `confirmed` | `in_service` | From 30 minutes before start onward; reason forbidden |
| `confirmed` | `cancelled` | Before start; reason required |
| `confirmed` | `no_show` | At/after start; reason forbidden |
| `in_service` | `completed` | Any time; reason forbidden |

Terminal states cannot transition. Accepted reasons are strings, trimmed, non-empty, and at most 300 characters. Every transition conditionally matches the current status, appends one immutable actor snapshot, and releases capacity only for `cancelled`, `rejected`, or `no_show`.

## Error and body-size policy

The standard JSON body limit is 20 KiB. Only exact `PATCH /api/admin/workshop-schedule` receives a 30 KiB limit for the bounded override payload. Oversize requests return `413` without echoing request content. Malformed JSON returns `400 { "message": "Request body must contain valid JSON" }`; unexpected server faults return `500 { "message": "Internal server error" }`.

The API intentionally returns stable, non-enumerating 404s and safe duplicate/conflict messages. Consult the automated route and security tests before changing any status, timing, ownership, serialization, or error contract.
