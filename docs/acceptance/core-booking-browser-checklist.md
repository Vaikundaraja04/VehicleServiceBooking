# Core Booking v1.0.0 — browser acceptance checklist

## Record header

| Field | Value |
|---|---|
| Release | Core Booking v1.0.0 candidate |
| Source/build hash | Record after final ZIP creation |
| Browser/version | PENDING — run on Windows Chrome or Edge |
| OS | PENDING |
| Date/time/timezone | PENDING |
| Tester initials | PENDING |
| Viewports | 320×800, 768×1024, 1440×900 CSS pixels |
| Isolated environment | Local disposable MongoDB `rs0` database |
| Overall interactive result | **PENDING/BLOCKED in this executor** |
| Evidence location | PENDING — sanitized application-only screenshots |
| Cleanup/retention | PENDING |

This record deliberately does not convert JSDOM, server tests, or static CSS checks into browser PASS. The build executor has no Chrome, Chromium, Firefox, Playwright, Puppeteer, Docker, or other executable browser path; the previously attempted cloud browser could not reach localhost.

## Automated evidence already passed

Snapshot executed 2026-08-30 07:19 UTC. Later source changes require a fresh full run rather than editing these counts by assumption.

| Area | Evidence | Status |
|---|---|---|
| Server regression | 577/577 tests, 16 suites, no failures/skips/todos | PASS (automated) |
| Client regression | 874/874 tests, 38 files | PASS (JSDOM/static) |
| Client lint/build | ESLint clean; Vite build, 72 modules | PASS (automated) |
| Admin service UI | 55 focused tests; independent review 0 findings | PASS (JSDOM/static) |
| Admin schedule UI | 20 focused tests; independent review 0 findings | PASS (JSDOM/static) |
| Admin queue UI | 98 focused tests; independent review 0 findings | PASS (JSDOM/static) |
| Admin detail UI | 165 focused tests; independent review 0 findings | PASS (JSDOM/static) |
| HTTP/domain integrity | schedule races/conflicts, booking races/transitions, privacy serializers | PASS (automated) |

## Safe test data

- Use only synthetic accounts and a disposable local database.
- Use a unique run tag such as `accept-YYYYMMDD-HHmm` in usernames, service names, and plates.
- Never record passwords, cookies, JWTs, storage, `.env` values, database URIs, or complete verification/reset/invitation links.
- Prepare two customer accounts, one invited administrator, at least one active and one archived vehicle, and at least 21 bookings for real pagination.
- Booking creation requires at least 60 minutes of lead time. Starting service becomes legal 30 minutes before start; no-show becomes legal at/after start.

## Customer path

| ID | Action and expected result | 320 | 768 | 1440 | Evidence |
|---|---|---|---|---|---|
| C-01 | Verified customer signs in; customer navigation only | PENDING | PENDING | PENDING | — |
| C-02 | Active vehicle and active service load safely | PENDING | PENDING | PENDING | — |
| C-03 | Closed date has no slots; open date shows duration-aware slots | PENDING | PENDING | PENDING | — |
| C-04 | Review and create booking; it appears in Upcoming and detail/timeline match snapshots | PENDING | PENDING | PENDING | — |
| C-05 | Eligible cancellation releases capacity for Customer B | PENDING | PENDING | PENDING | — |
| C-06 | Archived-vehicle stale submit fails with safe Vehicle 404 and creates no booking | PENDING | PENDING | PENDING | — |
| C-07 | Other customer's booking detail is safe 404 | PENDING | PENDING | PENDING | — |
| C-08 | Deactivated-service stale submit fails with the exact unavailable-service response and creates no booking | PENDING | PENDING | PENDING | — |

## Administrator path

| ID | Action and expected result | 320 | 768 | 1440 | Evidence |
|---|---|---|---|---|---|
| A-01 | Admin signs in; exact role navigation and `aria-current` | PENDING | PENDING | PENDING | — |
| A-02 | Create/edit/deactivate/reactivate a tagged service; no delete | PENDING | PENDING | PENDING | — |
| A-03 | Load and validly replace all seven schedule rows; reload persists | PENDING | PENDING | PENDING | — |
| A-04 | Bay reduction/closure conflicting with retained booking gives exact 409; draft and stored schedule remain unchanged | PENDING | PENDING | PENDING | — |
| A-05 | Queue search/filter/date/page controls work with >20 records | PENDING | PENDING | PENDING | — |
| A-06 | Detail shows safe customer/vehicle/service/bay/actor snapshots | PENDING | PENDING | PENDING | — |
| A-07 | `requested → confirmed → in_service → completed` | PENDING | PENDING | PENDING | — |
| A-08 | Separate requested booking is rejected with a reason | PENDING | PENDING | PENDING | — |
| A-09 | Separate confirmed booking becomes no-show at/after start | PENDING | PENDING | PENDING | — |
| A-10 | Admin cancellation requires a reason and releases capacity | PENDING | PENDING | PENDING | — |

## Negative checks

| ID | Action and expected result | 320 | 768 | 1440 | Evidence |
|---|---|---|---|---|---|
| N-01 | Guest and wrong-role URLs redirect without a protected feature request | PENDING | PENDING | PENDING | — |
| N-02 | Removing the mounted-page session cookie causes exactly one `/login` redirect after the next protected action | PENDING | PENDING | PENDING | — |
| N-03 | Customer DOM/network responses omit admin identity, bay number, raw references, password/token/cookie, and `reservedSlotKeys` | PENDING | PENDING | PENDING | — |
| N-04 | Two synchronized customers submit the same final-capacity slot; exactly the available capacity succeeds, losers receive 409, and persisted/visible capacity remains correct | PENDING | PENDING | PENDING | — |

For N-04, prepare one remaining bay in a disposable database, open the review step in two isolated browser profiles, submit as nearly simultaneously as practical, and verify the result through customer history and the administrator queue. Never capture cookies or request headers as evidence.

## Responsive and accessibility checks

| ID | Check at each viewport | 320 | 768 | 1440 | Evidence |
|---|---|---|---|---|---|
| R-01 | Tab/Shift+Tab reach every control; Enter/Space activate native controls; focus stays visible and never traps | PENDING | PENDING | PENDING | — |
| R-02 | Every input has a label/help association; headings, landmarks, and `aria-current` identify context | PENDING | PENDING | PENDING | — |
| R-03 | Loading, empty, validation, success, conflict, error, and retry states are perceivable and announced | PENDING | PENDING | PENDING | — |
| R-04 | Inline confirmations open, validate, dismiss, and restore/focus safely; they are not modal dialogs | PENDING | PENDING | PENDING | — |
| R-05 | No content clips and `max(document.documentElement.scrollWidth, document.body.scrollWidth) <= window.innerWidth` | PENDING | PENDING | PENDING | — |
| R-06 | With reduced motion and forced colors/high contrast enabled, information, focus, errors, status, and active navigation remain perceivable | PENDING | PENDING | PENDING | — |

## Sanitized evidence rules

Capture only the application viewport with synthetic data. Do not capture DevTools Storage/Application tabs, request headers, email tokens, terminal credentials, HAR files, or real personal/vehicle data. Each evidence filename should use only the scenario ID and viewport, for example `A-04-768.png`.
