# Hosting preparation verification

**Date:** 6 September 2026  
**State:** Local implementation and automated verification completed. Public deployment is pending the host, domain and production credentials.

## Changes included

- Production frontend requests default to `/api`; development retains `http://localhost:5000/api`. An explicit `VITE_API_URL` still takes precedence.
- The earlier administrator booking queue correction uses customer IDs when validating immutable status-history actors. A customer rename no longer invalidates that queue response.
- A read-only configuration preflight and production build/start scripts are available at the project root.
- Nginx, systemd and environment templates implement the documented one-server, one-domain deployment.
- The complete hosting guide covers migration, first-admin provisioning, Gmail, mobile acceptance, updates and recovery.

## Recorded results

| Check | Result and scope |
| --- | --- |
| Full client suite | **990 passed**, 45 test files |
| Full server suite | **650 passed**, 19 suites; isolated MongoDB replica set |
| Production preflight CLI suite | **19 passed**; synthetic configuration only |
| Client lint | Passed using `npm run lint` |
| Server lint | Passed using `node node_modules/eslint/bin/eslint.js .` from `server`; the ZIP's original executable wrapper lacked Linux execute permission |
| New root scripts lint | Passed using the existing backend ESLint configuration |
| Production build | Passed from a clean source staging directory with no local environment file; 86 modules transformed |
| Production API regression | Tests first exposed the localhost production fallback, then passed with the `/api` default; development and explicit-override cases also pass |
| Production environment example | Correctly exits with failure until domain, secret, database and Gmail placeholders are replaced |
| Actual production-mode API smoke | Passed with synthetic users and an isolated MongoDB replica set: real password login, `HttpOnly`/`Secure`/`SameSite=Lax` session cookie, authenticated admin queue and 401 for an unauthenticated queue request |
| Customer rename regression | Actual booking creation, confirmation and profile rename preserve historical usernames; the returned queue record is accepted by the corrected frontend validator |
| systemd unit syntax | Passed after substituting this test environment's actual Node executable path in a temporary copy; the target server must verify its own paths, account and environment |
| Nginx configuration execution | Not run: Nginx is not installed in this test environment. Run `nginx -t` with real TLS files on the selected host |
| Mobile visual checks | Attempted but blocked: the browser environment rejected the preview server's port binding with `EPERM`. No mobile screenshot or visual-pass claim is made |
| Real Android/iPhone access | Pending the deployed HTTPS URL |
| Public DNS, TLS and process restart | Pending the actual host |
| Real Gmail delivery | Not performed; no real email was sent by this verification |
| Live database migration and backup restore | Not performed; existing user data was not altered |

Client tests emitted React `act(...)` warnings and server tests emitted Mongoose deprecation warnings. Both suites completed with zero failed tests. These warnings are not evidence of real-device or production-host acceptance.

Test runtime: Node.js 24.19.0 and MongoDB 7.0.24. Client dependencies were installed from the lockfile; backend checks used the available dependency tree. Install from the included lockfiles on the selected Linux host and rerun the required deployment checks there. Dependency folders and build output are excluded from the source ZIP.

## What the checks do not establish

The preflight checks settings without making network calls. A valid-looking URI does not prove credentials, MongoDB transaction support, DNS resolution or Gmail delivery. The frontend API tests verify request addressing; the API smoke verifies Express behavior. Neither substitutes for testing Nginx, browser cookies over real HTTPS or a phone on mobile data.

The synthetic username-change scenario demonstrates the identified validator bug. The exact booking shown in the original screenshot was not present in the uploaded database snapshot.

## Remaining launch acceptance

1. Confirm the owner-selected provider, region, spending limit, domain, database destination and Gmail sender.
2. Install clean Linux dependencies, build the frontend and configure private environment values.
3. Verify DNS, TLS renewal, Nginx routing, Node executable paths and service supervision.
4. Initialize or migrate the approved database, verify the first administrator and review pending notification messages before starting the email worker.
5. Test customer registration, login, booking, administrator status changes, cancellation, reports and real email links through the public HTTPS origin.
6. Test the guide's phone-width and real-device matrix, including Android/iPhone and mobile data; fix any observed layout problems.
7. Verify persistence after restart and restore a backup into a separate test database.
8. Complete the agreed public-launch review.

Start with `deploy/README.md`. No hosting plan, domain, database service or paid resource has been created by this preparation.
