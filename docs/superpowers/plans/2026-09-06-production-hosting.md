# Production Hosting Preparation Implementation Plan

> Execute inline in the existing isolated ZIP working copy. No external repository is attached. Review each task before continuing.

**Goal:** Deliver a clean, tested MERN source package for the approved single-domain Linux hosting design.

**Architecture:** Nginx serves the React build and proxies `/api` to a loopback-bound Node process supervised by systemd. The existing backend connects to a managed MongoDB replica set and runs its Gmail worker. Production browser requests default to `/api`.

**Tech Stack:** Existing Node.js 24, React, Vite, Express and Mongoose versions; Nginx and systemd infrastructure.

**Spec:** `docs/deployment/HOSTING_GUIDE.md`, approved by the owner in this conversation.

## Global constraints

- Preserve MongoDB, Express, React and Node.js, existing lockfiles, and the booking queue fix.
- Keep real configuration, existing data and passwords out of the deployment archive.
- Do not create paid resources, choose a domain or migrate live data without the remaining owner details.
- No new email provider, offline app, native mobile app or unrelated redesign.
- Verify on synthetic records; no real email is sent during automated tests.

## Task 1: Production API addressing

Files: `client/src/api/authApi.js`, new `client/src/api/productionApi.test.js`.

- [x] Add tests importing the actual API client under production, development and explicit API override environments; assert the outbound URL and credentialed request behavior.
- [x] Run the production case and confirm it fails against the original localhost fallback.
- [x] Change the default to `import.meta.env.PROD ? '/api' : 'http://localhost:5000/api'`, preserving explicit `VITE_API_URL` precedence.
- [x] Run the focused client API suites.

## Task 2: Production configuration preflight

Files: new `scripts/check-production.js`, `scripts/check-production.test.js`, root `package.json`.

- [x] Write CLI tests using child processes with explicit synthetic environments, independently asserting success, rejection of unsafe origins/missing credentials and absence of secrets in output.
- [x] Implement a read-only preflight consuming process environment and existing `readConfig`/`validateGmail`; do not connect to a database or send email.
- [x] Check production mode, canonical public HTTPS origin, an authenticated MongoDB URI with a database and transaction topology hint, Gmail settings, loopback binding and explicit trusted proxies for the Linux blueprint.
- [x] Add root `build:production`, `start:production`, `check:production`, and `test:production` scripts with explicit child working directories.
- [x] Run the CLI tests, then both an expected-failing example template and a synthetic valid configuration.

## Task 3: Concrete deployment files

Files: `deploy/linux/nginx.conf.example`, `deploy/linux/vehicle-service-booking.service`, `deploy/linux/server.env.example`, `deploy/README.md`, source package documentation.

- [x] Create templates matching the approved source guide: TLS domain placeholders, preserved `/api` prefix, SPA deep-link fallback and private upstream.
- [x] Include the preflight as systemd `ExecStartPre`, retain the full project directory layout and document the real Node binary path requirement.
- [x] Explain secret setup, catalog seeding, production administrator provisioning, clean installs, process lifecycle, data migration and rollback.
- [x] Validate the available configuration tooling; record checks that need an actual host.

## Task 4: Release verification and handoff

- [x] Build production assets; run full client tests/lint and relevant backend tests against an isolated replica set.
- [x] Test same-origin API behavior and mobile layouts with synthetic data where the browser surface permits it; report real-device and live SMTP checks separately.
- [x] Fix only observed problems and rerun the affected checks.
- [x] Package source, lockfiles, deployment configuration and verification notes, excluding credentials, data, dependencies and temporary files.
- [x] Prepare the deployment archive handoff and identify the provider, budget and domain information still needed for launch.

## Completion notes

Local preparation is complete. The production API smoke and automated suites passed. Mobile visual checking was attempted but the browser environment rejected preview-server port binding; real-phone acceptance remains open. Nginx, DNS, TLS, live SMTP and migration checks require the selected host. See `docs/deployment/VERIFICATION.md`.
