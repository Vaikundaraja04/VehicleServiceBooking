# Dashboard Insights v1.1.0 Design

Date: 2026-08-30

## Purpose

Add one portfolio-grade read-only dashboard subsystem to the existing Vehicle Service Booking MERN application. The dashboard should help a customer understand the next useful action and help an administrator understand current workshop workload. It must reuse existing booking, vehicle, service, schedule, authentication, and privacy contracts.

This phase demonstrates MongoDB aggregation, role-safe API design, deterministic time handling, accessible React state management, and production-oriented testing. It does not add payments, messaging, external AI, telematics, mileage, maintenance intervals, or fabricated predictive claims.

## Scope

### Customer dashboard

- Show active vehicle, upcoming booking, and completed booking counts.
- Show the nearest upcoming booking, or a deterministic action prompt when none exists.
- Show the five newest safe status-history events from that customer's bookings.
- Preserve the current account profile, password, vehicle, booking, and sign-out actions.

The action prompt follows one exact priority:

1. If an upcoming booking exists, link to that booking.
2. Otherwise, if an active vehicle exists, link to service booking.
3. Otherwise, link to vehicle creation.

The prompt is not a maintenance prediction. The application has no mileage, diagnostic, or manufacturer interval data, so it must not claim that a vehicle is due for service.

### Administrator dashboard

- Show total bookings and exact counts for every booking status.
- Show today's appointment count using the configured workshop time zone.
- Show seven calendar days of workload: date, appointment count, reserved minutes, available bay-minutes, and utilization percentage.
- Show up to five attention items in urgency order.
- Preserve current links to booking queue, services, workshop schedule, vehicles, invitations, password change, and sign-out.

Attention rules are exact and read-only:

1. `confirmed` booking whose start is at or before the captured current instant.
2. `requested` booking starting within the next 24 hours.
3. `in_service` booking.

Items are ordered by rule priority, then `startsAt`, then identifier. The dashboard does not mutate or automatically transition a booking.

## Architecture

### HTTP boundary

Add one endpoint:

```text
GET /api/dashboard
```

The route authenticates first, rejects every query parameter, and dispatches by the current database role. It permits only `customer` and `admin`. A stale JWT role cannot select another projection because authentication reloads the current user before the dashboard service is called.

No dashboard POST, PATCH, PUT, or DELETE route exists.

### Server units

- `routes/dashboardRoutes.js`: authentication, role authorization, empty-query contract, controller dispatch.
- `controllers/dashboardController.js`: capture one `now` instant, call the role-specific service, return `{ dashboard }`.
- `services/dashboardService.js`: read-only customer and administrator aggregation functions.
- `utils/dashboardResponse.js`: exact safe response builders and plain-value cloning.

The application mounts the router at `/api/dashboard`. The service accepts `now` as an injected `Date` so boundary, daylight, and workload tests are deterministic. Invalid `now` fails before any database query.

No analytics collection, cache, scheduled job, or denormalized counter is introduced. Existing source collections remain authoritative.

## Response contracts

All dates are JSON ISO instants. Local workload dates use canonical `YYYY-MM-DD` strings in the configured workshop time zone.

### Customer response

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
      "id": "booking-id",
      "vehicle": {
        "id": "vehicle-id",
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
      "href": "/bookings/booking-id",
      "label": "View your next appointment"
    },
    "recentActivity": [
      {
        "bookingId": "booking-id",
        "toStatus": "confirmed",
        "changedAt": "2026-08-30T07:00:00.000Z",
        "actorLabel": "Administrator",
        "reason": null
      }
    ]
  }
}
```

`nextBooking` is `null` when absent. `recentActivity` contains at most five entries. Customer output never contains customer identity, administrator identity, bay number, raw references, reservation keys, or token fields.

The other valid actions are exactly:

```json
{ "kind": "book_service", "href": "/book-service", "label": "Book a service" }
```

```json
{ "kind": "add_vehicle", "href": "/vehicles", "label": "Add your first vehicle" }
```

### Administrator response

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
      }
    ],
    "attention": [
      {
        "kind": "overdue_confirmed",
        "bookingId": "booking-id",
        "startsAt": "2026-08-30T07:30:00.000Z",
        "status": "confirmed",
        "customer": {
          "id": "customer-id",
          "username": "demo_customer",
          "email": "demo@example.invalid"
        },
        "vehicleRegistrationNumber": "TN01AB1234",
        "serviceName": "Full service",
        "href": "/admin/bookings/booking-id"
      }
    ]
  }
}
```

`byStatus` always contains every supported status with a numeric zero when absent. `workload` always contains exactly seven ascending local dates beginning with the captured local current date.

## Workload calculation

Available bay-minutes come from the existing workshop schedule:

- Use the date override when one exists for a date.
- Otherwise use that date's ISO weekday row.
- A closed row contributes zero.
- An open row contributes `(closeMinutes - openMinutes) * bayCount`.

Reserved minutes count only bookings whose reservation is live under the existing booking policy. Each counted booking contributes its immutable snapshot duration once, including cross-slot services. Cancelled, rejected, completed, and no-show bookings do not occupy future capacity under the existing reservation contract.

Utilization is `0` when available capacity is zero. Otherwise it is `reservedMinutes / availableBayMinutes * 100`, rounded to one decimal place and capped at 100 for defensive display stability. An absent workshop schedule returns the existing controlled service-unavailable error rather than invented capacity.

All seven dates and both endpoints of the 24-hour attention window derive from the same captured `now` instant.

## Client design

- Add `api/dashboardApi.js` for the one protected GET request and centralized 401 handling.
- Refactor `DashboardPage.jsx` into a coordinator with role-specific presentational sections.
- Add `components/DashboardStatCard.jsx`, `components/CustomerDashboard.jsx`, and `components/AdminDashboard.jsx`.
- Reuse `AsyncState`, `BookingStatusBadge`, existing link styling, and booking presentation utilities where their contracts match.
- Keep the profile details and sign-out action available after insight content.

The page loads once per mount. Loading, error, retry, empty, and populated states are visible and announced. Retry performs one new request. A 401 uses the existing protected-session redirect behavior and does not render an authentication error card.

Administrator workload uses semantic text and progress elements, not a chart library. Status meaning and utilization remain understandable without color. At narrow widths, cards and workload rows become one column without horizontal scrolling. Reduced-motion and forced-color rules follow the existing application contracts.

## Error and security contracts

- Authentication and current-role authorization execute before dashboard work.
- Unknown or repeated query parameters produce the existing structured 400 response.
- A customer can never request administrator analytics through input.
- Aggregations match the authenticated customer identifier before unwind or projection.
- Output is built through an explicit allowlist. Raw MongoDB documents are never returned.
- No protected configuration, internal reservation key, password, token, cookie, or raw actor identifier appears in logs or responses.
- Database failures use the existing centralized error boundary.
- The route remains read-only and does not require the mutation Origin guard beyond the application's existing global origin policy.

## Data and index changes

No new persisted fields are needed. Add a descending `updatedAt` booking index only if the implemented explain plan or query shape requires it for recent activity. Existing `customer + startsAt` and `status + startsAt` indexes remain the primary dashboard indexes. Any new index must have a named regression test and be initialized through the current startup index contract.

## Testing

### Server

- Route order: authentication, current role, empty query, controller.
- Exact customer and administrator response shapes.
- Customer ownership and privacy under mixed-account data.
- Every status count, zero filling, stable ordering, and deterministic `now`.
- Local-date boundaries, closed days, overrides, bay counts, multi-slot durations, and seven-day capacity math.
- All three attention rules, priority, tie-breaking, and five-item limit.
- Missing schedule and database failure behavior.
- No write method is called during dashboard reads.

### Client

- API URL, credentials, response envelope, error forwarding, and 401 redirect.
- Customer populated, no-upcoming, no-vehicle, activity, loading, error, retry, and sign-out states.
- Administrator status, workload, attention, empty-attention, loading, error, and retry states.
- Role privacy: customer markup has no admin identity, bay, reservation, or admin-only links.
- Keyboard, labels, headings, progress semantics, live messages, narrow CSS, forced colors, and reduced motion.
- Existing dashboard navigation and account flows remain green.

### Release gate

- Guarded full server suite and server lint.
- Full client suite, client lint, and production build.
- Server and client dependency audits.
- Fail-closed release verifier and independent ZIP extraction/manifest verification.
- New separately named `VehicleServiceBooking-dashboard-insights-v1.1.0.zip`; the verified v1.0.0 archive remains unchanged.

## Acceptance

Automated acceptance requires exact response and privacy tests, deterministic workload tests, full regression, lint, build, dependency audit, and verified release packaging. Real-browser checks at 320, 768, and 1440 CSS-pixel widths remain separately recorded and cannot be marked PASS from JSDOM or static CSS tests.
