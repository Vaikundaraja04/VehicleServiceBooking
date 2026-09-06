# Vehicle Service Booking Core Booking — Gate 4 Release Evidence Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce reproducible, no-secret release evidence for the approved Core Booking Phase without weakening the guarded MongoDB test setup.

**Architecture:** Application code remains in `server/` and `client/`. Docker Compose runs a single-node MongoDB replica set for transactional development and database-backed CI. A one-shot `mongo-init` service initializes `rs0`; API and server-test containers connect through the Compose hostname `mongo`.

**Tech Stack:** Node.js 24, npm, Docker Compose v2, MongoDB 8, GitHub Actions, Express/Mongoose/node:test/Supertest, React/Vite/Vitest.

**Spec:** `docs/superpowers/specs/2026-08-29-core-booking-design.md`, sections 13–18.

## Global Constraints

- [ ] Preserve the original uploaded ZIP unchanged. Create a new release ZIP only after every gate passes.
- [ ] Never copy or edit real `server/.env`. Exclude `.env`, `node_modules`, `dist`, `coverage`, database data/volumes, `.git`, and nested ZIP files from the release ZIP.
- [ ] Automated cleanup may target only `vehicle_service_booking_test`; development uses `vehicle_service_booking`.
- [ ] Database-backed test URI is `mongodb://mongo:27017/vehicle_service_booking_test?replicaSet=rs0` inside Compose. Do not run booking transaction/race tests against standalone MongoDB.
- [ ] Do not add badges, coverage percentages, live URLs, or production-security claims unless independently verified.

## File map

### Create

- [ ] `README.md` — product, roles, architecture, integrity decisions, setup, seed, commands, demo, screenshots, exclusions, and honest limitations.
- [ ] `server/.env.example` and `client/.env.example` — safe templates only.
- [ ] `server/Dockerfile` — reproducible API/test image that consumes the Gate-1 replica set.
- [ ] `.github/workflows/ci.yml` — no-secret CI.
- [ ] `docs/api/core-booking-api.md` — API contract summary.
- [ ] `docs/acceptance/core-booking-browser-checklist.md` — browser acceptance record.
- [ ] `docs/release/gate-4-verification.md` — sanitized PASS/FAIL record.
- [ ] `scripts/release-verify.sh` — fail-closed scan, manifest, packaging, hash report.

### Modify

- [ ] `server/package.json`: add `lint`, `seed:booking`, `test:race`, and `test:all`; add `engines.node: ">=24 <25"`.
- [ ] `client/package.json`: add `engines.node: ">=24 <25"`; retain `test`, `lint`, and `build`.
- [ ] `docker-compose.yml`: extend the Gate-1 `mongo`/`mongo-init` contract with `api` and `server-test`; do not replace its image, service names, replica member, or initialization script.
- [ ] Root/server/client `.gitignore`: exclude local env variants, coverage, release staging, and Docker data while retaining `!.env.example`.

## Docker Compose contract

- [ ] `mongo`: existing Gate-1 `mongo:8`, command `mongod --replSet rs0 --bind_ip_all`.
- [ ] `mongo-init`: waits for `mongo` health, then runs `docker/mongo-init.sh`. The script uses `set -eu`, connects to `mongodb://mongo:27017/admin?directConnection=true`, calls `rs.initiate({_id:"rs0",members:[{_id:0,host:"mongo:27017"}]})` only when needed, and waits at most 60 seconds for `myState === 1`.
- [ ] `api`: builds `server/Dockerfile`, maps `5000:5000`, reads ignored `server/.env`, overrides database URI with `mongodb://mongo:27017/vehicle_service_booking?replicaSet=rs0`.
- [ ] `server-test`: builds the same image, receives no real env file/Gmail values, sets all three guarded test URI variables to `mongodb://mongo:27017/vehicle_service_booking_test?replicaSet=rs0`, and runs `npm run test:all:external`.

## Task 1 — Container integration and guarded-test proof

- [ ] Re-run the Gate-1 helper tests for valid dynamic/Compose `rs0` URIs, rejected development database names, missing `replicaSet=rs0`, and refusal to clear an unsafe database.
- [ ] Add `server/Dockerfile` using Node 24 and `npm ci`, then extend—never recreate—the Gate-1 Compose file with `api` and `server-test`.
- [ ] `server-test` sets identical `MONGO_URI_TEST`, `MONGO_URI`, and `TEST_DATABASE_URI` values for `mongodb://mongo:27017/vehicle_service_booking_test?replicaSet=rs0` and runs the external-replica test script.
- [ ] Verify from repository root:

```bash
docker compose up -d mongo
docker compose run --rm mongo-init
docker compose exec mongo mongosh --quiet 'mongodb://localhost:27017/admin?directConnection=true' --eval 'if (rs.status().myState !== 1) quit(1)'
docker compose run --rm server-test
```

- [ ] Record PASS only when all commands exit zero and the test output ends with `# fail 0`.

## Task 2 — Full regression and race verification

- [ ] Add these server scripts after the Gate 1 race test exists:

```json
{
  "lint": "eslint .",
  "seed:booking": "node scripts/seed-booking-foundation.js",
  "test:external": "node --require ./tests/test-env.js --test --test-concurrency=1",
  "test:race": "npm test -- tests/services/bookingService.race.test.js",
  "test:race:external": "npm run test:external -- tests/services/bookingService.race.test.js",
  "test:all": "npm run lint && npm test && npm run test:race",
  "test:all:external": "npm run lint && npm run test:external && npm run test:race:external"
}
```

- [ ] Add server ESLint configuration and lockfile changes; it lints source, scripts, and tests.
- [ ] Execute the complete server matrix twice:

```bash
docker compose run --rm server-test npm run test:all:external
docker compose run --rm server-test npm run test:all:external
```

- [ ] Execute full client verification:

```bash
npm --prefix client ci
npm --prefix client test -- --run
npm --prefix client run lint
npm --prefix client run build
```

- [ ] PASS requires all commands to exit zero, existing auth/vehicle tests to remain present, and the Promise-based booking race suite to pass twice.

## Task 3 — CI

- [ ] Create `.github/workflows/ci.yml` on `push` and `pull_request`; use `actions/checkout@v4` and `actions/setup-node@v4` with Node 24 plus separate npm cache keys for server/client locks.
- [ ] Use this exact CI command order:

```yaml
- run: docker compose up -d mongo
- run: docker compose run --rm mongo-init
- run: docker compose run --rm server-test npm run test:all:external
- run: npm --prefix client ci
- run: npm --prefix client test -- --run
- run: npm --prefix client run lint
- run: npm --prefix client run build
- run: bash scripts/release-verify.sh --check-only
```

- [ ] CI has no Gmail, external MongoDB, deployment, or other secrets. The database remains Compose-network-only and test-named.

## Task 4 — Documentation, templates, and API evidence

- [ ] Write root `README.md` with fixed sections: problem; roles; architecture diagram; transaction guards and unique multikey reservation index; Node 24/Docker Compose prerequisites; setup; Compose/test commands; `docker compose run --rm api npm run seed:booking`; demo scenario; screenshots from seeded data; exclusions; limitations; and no production-deployment claim.
- [ ] `server/.env.example` contains exactly `PORT`, `MONGO_URI`, `CLIENT_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `NODE_ENV`, and optional `TRUSTED_PROXY_IPS`. Use `MONGO_URI=mongodb://mongo:27017/vehicle_service_booking?replicaSet=rs0`, `CLIENT_URL=http://localhost:5173`, `JWT_EXPIRES_IN=8h`, and intentionally unusable secret/email placeholders.
- [ ] `client/.env.example` contains only `VITE_API_URL=http://localhost:5000/api` and a comment that `VITE_` values are public.
- [ ] Extend template tests: backend template names exist and cannot pass JWT validation; client test rejects secret-like `VITE_` keys.
- [ ] Write `docs/api/core-booking-api.md`: tables for all section-9 routes, role, input, success envelope, pagination, and 400/401/403/404/409 outcomes. State that customer responses omit reservation keys and administrator identity.

## Task 5 — Browser, accessibility, and responsive acceptance

- [ ] Create the checklist record header: release version, browser/version, viewport, date/time, tester initials, PASS/FAIL, sanitized evidence link. Never record credentials, cookies, tokens, or full email URLs.
- [ ] Customer path: verified login; active vehicle; active service; closed/open availability dates; duration-aware slot; review/create; upcoming detail/timeline; permitted cancellation; second safe account verifies released capacity.
- [ ] Admin path: create/edit/deactivate service; unavailable-service rejection; schedule change plus 409 conflict; queue search/filter/pagination; requested→confirmed→in_service→completed; requested→rejected; confirmed→no_show; admin cancellation with reason.
- [ ] Negative path: roles cannot cross routes; other customer booking returns 404; archived vehicle cannot book; concurrent same-slot requests preserve capacity; 401 redirects once; no UI/API response leaks token, cookie, password, raw reservation key, or admin identity to a customer.
- [ ] At 320px, 768px, and 1440px, check keyboard navigation, visible focus, labels, `aria-current`, status/error announcements, dialogs, reduced motion, loading/empty/error/retry states, and no horizontal page scroll.
- [ ] Record only sanitized results in `docs/release/gate-4-verification.md`.

## Task 6 — Dependency, secret, and ZIP release verification

- [ ] Run:

```bash
npm --prefix server audit --audit-level=high
npm --prefix client audit --audit-level=high
npm --prefix server ls --omit=dev
npm --prefix client ls --omit=dev
bash scripts/release-verify.sh --check-only
```

- [ ] The script fails if forbidden files are found or source assigns a non-template value to `JWT_SECRET`, `GMAIL_APP_PASSWORD`, or `MONGO_URI`, or any `VITE_` name contains `SECRET`, `PASSWORD`, `TOKEN`, or `KEY`. It scans README, client, server, docs, CI, Docker, and scripts without printing matched values; it skips dependencies, build outputs, Git metadata, original ZIP, and output ZIP.
- [ ] Only after the check succeeds:

```bash
bash scripts/release-verify.sh --output ../VehicleServiceBooking-core-booking-v1.0.0.zip
unzip -t ../VehicleServiceBooking-core-booking-v1.0.0.zip
unzip -l ../VehicleServiceBooking-core-booking-v1.0.0.zip
sha256sum ../VehicleServiceBooking-core-booking-v1.0.0.zip
```

- [ ] Required archive inclusions: README, both lockfiles, CI workflow, Compose/Docker init assets, both env examples, API docs, acceptance checklist, source, and tests. Required exclusions: env files, dependencies, dist, coverage, Git metadata, nested ZIPs, and database files/volumes.
- [ ] Record absolute ZIP path, non-zero byte size, entry count, and SHA-256 in `docs/release/gate-4-verification.md`. `unzip -t` must pass independently.

## Final completion gate

- [ ] `docker compose run --rm server-test npm run test:all:external` passes twice.
- [ ] `npm --prefix client test -- --run`, `npm --prefix client run lint`, and `npm --prefix client run build` pass.
- [ ] Browser acceptance is complete and sanitized.
- [ ] CI reproduces the no-secret replica-set checks.
- [ ] Dependency/exclusion/secret scan and final ZIP integrity/manifest verification pass.
