# Dashboard Insights v1.1.0 — real-browser acceptance checklist

## Record header

| Field | Value |
| --- | --- |
| Release | Dashboard Insights v1.1.0 candidate |
| Source commit/build hash | PENDING — record the exact Task 10 candidate |
| Browser/version | PENDING — a real browser has not been executed |
| OS | PENDING |
| Date/time/time zone | PENDING |
| Tester initials | PENDING |
| Viewports | 320×800, 768×1024, 1440×900 CSS pixels |
| Data set | PENDING — disposable database with synthetic customer/admin records |
| Overall interactive result | **PENDING — no real-browser run has been executed for this checklist** |
| Evidence location | PENDING — sanitized application-only captures, if produced |
| Cleanup/retention | PENDING |

JSDOM component tests, server tests, build output, and static CSS inspection do not turn any item below into a browser PASS. Every item remains PENDING until a tester executes it in the recorded real browser at the recorded viewport.

## Safe setup

- Use only disposable synthetic accounts, vehicles, registrations, services, notes, and bookings. Never use real customer or vehicle data.
- Prepare a verified customer with no vehicles/bookings; a verified customer with an active vehicle but no upcoming booking; a customer with populated summary, next booking, and recent activity; and an administrator with all statuses, seven-day workload, and all three attention kinds.
- Prepare controlled empty administrator data with a valid workshop schedule, plus a recoverable server error for Retry. Do not alter production data to manufacture evidence.
- Keep DevTools credentials, request headers, cookies, storage, database connection values, verification/reset/invitation links, and private email content out of screenshots and recordings.
- Record the exact source commit/build before execution. If source or build output changes, start a new record rather than carrying results forward.

## Dashboard state and action matrix

| ID | Action and expected result | 320 | 768 | 1440 | Sanitized evidence |
| --- | --- | --- | --- | --- | --- |
| D-01 | Open `/dashboard`; the initial `Loading…` status is perceivable and no stale customer/admin insight section is shown | PENDING | PENDING | PENDING | PENDING |
| D-02 | Populated customer shows three counts, nearest appointment snapshot, exact **View your next appointment** link, and at most five newest safe activity entries | PENDING | PENDING | PENDING | PENDING |
| D-03 | Customer with no upcoming booking and no active vehicle shows `No upcoming appointment` plus exact **Add your first vehicle** action | PENDING | PENDING | PENDING | PENDING |
| D-04 | Customer with an active vehicle but no upcoming booking shows exact **Book a service** action and no due-for-service prediction | PENDING | PENDING | PENDING | PENDING |
| D-05 | Customer with no activity shows `No recent booking activity` without an empty list or misleading count | PENDING | PENDING | PENDING | PENDING |
| D-06 | Recoverable dashboard failure is announced as an alert; activating **Retry** performs one new request, returns to loading, then renders the new result without stale content | PENDING | PENDING | PENDING | PENDING |
| D-07 | Current-session `401` clears the protected session and redirects once to `/login` without rendering an authentication error card | PENDING | PENDING | PENDING | PENDING |
| D-08 | Populated administrator shows total/today counts, all seven ordered status counts, exactly seven local workload dates with text plus named progress, and at most five attention items | PENDING | PENDING | PENDING | PENDING |
| D-09 | Empty administrator data zero-fills every status, retains seven workload rows, and shows `No bookings need attention` | PENDING | PENDING | PENDING | PENDING |
| D-10 | Attention order is overdue confirmed, requested within 24 hours, then in service; ties follow start time, then booking identity; each **Review booking** link opens its matching detail | PENDING | PENDING | PENDING | PENDING |
| D-11 | Workload text agrees with appointment count, reserved/available bay-minutes, visible percentage, closed-day zero capacity, and the progress value; meaning is not color-only | PENDING | PENDING | PENDING | PENDING |
| D-12 | Reading or retrying the dashboard sends only `GET /api/dashboard` and does not create, edit, transition, cancel, or delete any record | PENDING | PENDING | PENDING | PENDING |

## Role isolation and privacy matrix

| ID | Action and expected result | 320 | 768 | 1440 | Sanitized evidence |
| --- | --- | --- | --- | --- | --- |
| I-01 | The customer insight sections (summary, next appointment, recent activity) and `GET /api/dashboard` response use only the customer envelope: no foreign customer identity, administrator identity, bay number, reservation key, guard, credential, cookie, token, or admin-only link appears. The separate preserved account profile may show only the signed-in customer's own username/email/mobile/address | PENDING | PENDING | PENDING | PENDING |
| I-02 | The administrator insight sections (summary, status, workload, attention) and dashboard response use only the administrator envelope; attention exposes only the documented booked customer's id/username/email and snapshot text, with no actor history, bay number, reservation key, guard, credential, cookie, or token. The separate preserved account profile may show only the signed-in administrator's own username/email/mobile/address | PENDING | PENDING | PENDING | PENDING |
| I-03 | After the account role changes, the current database role selects the next projection; an earlier opposite-role response never flashes or replaces current content | PENDING | PENDING | PENDING | PENDING |
| I-04 | Customer and administrator account links remain role-specific, while profile fields, change-password, and single-flight sign-out remain available | PENDING | PENDING | PENDING | PENDING |
| I-05 | An authenticated request with any dashboard query key shows the structured validation error; an unauthenticated request with the same query returns authentication first | PENDING | PENDING | PENDING | PENDING |

## Keyboard, naming, responsive, and display-mode matrix

| ID | Check at each viewport | 320 | 768 | 1440 | Sanitized evidence |
| --- | --- | --- | --- | --- | --- |
| A-01 | Tab and Shift+Tab reach dashboard links, Retry, account links, and sign-out in a logical order; Enter/Space activate native controls; focus remains visible and no focus trap occurs | PENDING | PENDING | PENDING | PENDING |
| A-02 | Screen-reader inspection identifies the page heading, booking summaries, next appointment/recent activity/status/workload/attention section names, status text, named utilization progress, loading status, error alert, and Retry button | PENDING | PENDING | PENDING | PENDING |
| A-03 | At 320 CSS pixels, cards/workload/actions form one column, long registration/service/customer/email text wraps, and `max(document.documentElement.scrollWidth, document.body.scrollWidth) <= window.innerWidth` | PENDING | PENDING | PENDING | PENDING |
| A-04 | At 768 and 1440 CSS pixels, the bounded multi-column layout remains readable with no overlap, clipping, inaccessible off-screen action, or unintended horizontal scrolling | PENDING | PENDING | PENDING | PENDING |
| A-05 | With forced colors/high contrast active, card/list/status/progress boundaries, focus, links, errors, and utilization/status meaning remain perceivable | PENDING | PENDING | PENDING | PENDING |
| A-06 | With reduced motion enabled, no necessary information depends on animation and loading/error/retry/role changes remain understandable without motion | PENDING | PENDING | PENDING | PENDING |
| A-07 | At 200% browser zoom, content reflows, text and controls remain readable/operable, and status/utilization meaning is preserved without color | PENDING | PENDING | PENDING | PENDING |

## Sanitized evidence record

Create one row per captured item. A textual observation is acceptable when a screenshot would risk exposing private browser state.

| Evidence field | Value |
| --- | --- |
| Scenario ID | PENDING |
| Viewport | PENDING |
| Browser/version | PENDING |
| OS | PENDING |
| Timestamp/time zone | PENDING |
| Tester | PENDING |
| Source commit/build hash | PENDING |
| Result | PENDING |
| Evidence filename or textual note | PENDING |
| Synthetic data/run tag | PENDING |
| Sanitation review (no real identity, credentials, cookies, tokens, headers, storage, private links, or terminal content) | PENDING |

Use filenames containing only the scenario and viewport, for example `D-08-1440.png`. Capture only the application viewport. Do not capture DevTools Application/Storage panels, request headers, cookie values, HAR files, email inboxes, terminal output, or real personal/vehicle data.
