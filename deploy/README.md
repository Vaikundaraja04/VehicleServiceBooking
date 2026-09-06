# Deploy the MERN project on one HTTPS domain

This package implements the approved hosting preparation. An actual host, domain, production database and Gmail sender still need to be configured. It has not been published online.

## What changed

- Production React builds default to the same-origin `/api` endpoint. Explicit `VITE_API_URL` overrides still work; local development keeps its localhost fallback.
- Root scripts expose `build:production`, `start:production`, `check:production` and `test:production`.
- `linux/` contains an Nginx template, systemd service and environment example for one Linux server with a managed MongoDB replica set.
- The earlier administrator queue fix remains included.

## Requirements

Use Node.js 24.x, Nginx, a non-root Linux service account, an authenticated MongoDB replica set or managed SRV connection, and an eligible Gmail App Password. The host must allow outbound Gmail SMTP on port 465 and keep the Node process running. There is no provider account or domain embedded in this package.

The supplied Linux blueprint uses Nginx and Node on the same machine. Its preflight deliberately requires `HOST=127.0.0.1`, `PORT=5000` and loopback proxy trust. A managed container platform may need a different binding and proxy layout; review those settings before selecting that alternative.

## 1. Keep existing data safe

Deploy into a separate release directory. Preserve the latest local project, its private configuration and its current database. Do not replace the working local directory with this source package or reset MongoDB.

The source package deliberately excludes credentials, database files, dependency folders and generated browser assets. Transfer real data only through the reviewed database migration procedure in `../docs/deployment/HOSTING_GUIDE.md`.

Local debug output and three unused root-level backend diagnostic snippets are also excluded. Existing automated tests are retained. `RELEASE-MANIFEST.sha256` covers this source package; the older `scripts/release-verify.sh` belongs to the dashboard release workflow and is not the deployment procedure for this package.

## 2. Install and build

From the project root, using a build environment with development dependencies:

```bash
npm --prefix client ci
npm --prefix client test -- --run
npm --prefix client run lint
npm run build:production
npm --prefix server ci
npm --prefix server run lint
npm --prefix server test
npm run test:production
```

Backend tests use an isolated test replica set. Never configure a production URI as a test URI. On the production server, install backend runtime dependencies with:

```bash
npm --prefix server ci --omit=dev
```

Only `client/dist` belongs in the public web root. Keep the entire server and root scripts available outside it. Never deploy Windows `node_modules` on Linux.

The production default `/api` requires Nginx's `/api/` proxy. An old `client/.env` containing a localhost `VITE_API_URL` overrides the default; do not copy local environment files into the release.

## 3. Provision the Linux directories and account

The templates assume:

| Item | Path or value |
| --- | --- |
| Service user and group | `vsb` |
| Active release | `/srv/vehicle-service-booking/current` |
| Server directory | `/srv/vehicle-service-booking/current/server` |
| Static web root | `/srv/vehicle-service-booking/current/client/dist` |
| Production environment | `/etc/vehicle-service-booking/server.env` |
| Node executable | `/usr/bin/node` |
| Service name | `vehicle-service-booking.service` |

Provision the non-root account and directories on the selected host. The Node account must read the release; Nginx must read only the static assets. Protect the environment file, for example with root ownership and mode 600 when systemd reads it. Verify the actual absolute Node executable path and adjust both service commands if needed.

## 4. Configure the environment

Use `linux/server.env.example` as a template for the private production environment. Replace the domain, database URI, secret and Gmail placeholders. URL-encode reserved characters in MongoDB credentials. Set the public contact fields to the workshop's actual details.

`CLIENT_URL` is the exact HTTPS origin with no trailing slash. `JWT_EXPIRES_IN` must be `8h`. Keep private values out of `VITE_` variables and out of any public repository.

From the release root, with permission to read the private file:

```bash
node --env-file=/etc/vehicle-service-booking/server.env scripts/check-production.js
```

Every check must pass. The preflight checks configuration only; it performs no DNS lookup, database connection, migration or email sending. Its MongoDB URI check does not establish server topology or connectivity—verify an actual booking transaction later.

## 5. Initialize the database and first administrator

Point the environment at the approved database before running any database command. For a new database, the existing seed can insert missing default services:

```bash
cd server
node --env-file=/etc/vehicle-service-booking/server.env scripts/seed-booking-foundation.js
```

For a migrated database, inspect existing services, indexes, records and pending mail before startup. Never run the demo seed on production.

Production startup does not automatically turn the Gmail sender into an administrator. Preserve the existing admin during migration or use `server/scripts/create-first-admin-document.js` and the private provisioning procedure described in `server/docs/authentication-manual-checks.md`. The helper generates an admin document; it does not insert it into MongoDB.

The Node entry point starts its email worker automatically. Review migrated pending messages before starting, because stored message text can contain the old website URL.

## 6. Configure DNS, TLS and Nginx

Point the owner-approved domain at the host. Obtain a valid TLS certificate and configure renewal using the selected host's supported method. Replace `booking.example.com` everywhere in `linux/nginx.conf.example`, and use the actual certificate paths.

The template:

- redirects HTTP to HTTPS;
- serves the compiled React files;
- preserves `/api` when proxying to Node on port 5000;
- supports browser refreshes on React routes;
- keeps API responses out of proxy/browser caching;
- returns a real 404 for missing hashed assets.

Validate the installed configuration with `nginx -t` before reloading Nginx. The certificate files must exist before the HTTPS block can validate. The initial certificate issuance procedure may temporarily need a separate HTTP-only configuration.

Keep the Node upstream private. If a CDN or another proxy is added, review forwarding and trust rules instead of reusing the direct-proxy assumptions unchanged.

## 7. Install and start the service

After paths, account, dependencies and secrets are configured, install `linux/vehicle-service-booking.service` in the host's systemd unit directory. Validate it with `systemd-analyze verify`, then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now vehicle-service-booking
sudo systemctl status vehicle-service-booking
```

The service runs the preflight before startup and restarts the API after a failure. Use the host's journal to inspect startup errors. Do not publish secret-bearing log output.

The root command `npm run start:production` also starts the API in the correct server directory, but the environment must already be provided. The root `npm start` remains the local development launcher.

## 8. Validate the deployed application

- Open `/api/health` through the public HTTPS domain. This is a liveness check, not database readiness.
- Verify administrator and customer login, cookies and deep-link refreshes.
- Create a vehicle and booking, approve it, and test permitted cancellation/status changes.
- Verify that a username change keeps bookings visible.
- Verify Gmail from the actual host: `gmail:check` authenticates without sending; registration/reset and booking flows test actual delivery.
- Check the public email links on a phone using mobile data.
- Check reports, record persistence after restart, and a restored backup.
- Complete the mobile acceptance matrix in the full guide, including real Android/iPhone browsers.

## 9. Updates and rollback

Keep a versioned release directory and the previous matching frontend/backend release. Build and test a new release before switching the active path and restarting the service. Preserve bookings accepted after an update; do not restore an old database to undo a frontend change.

See `../docs/deployment/VERIFICATION.md` for checks completed in this preparation and remaining host-specific checks. See `../docs/deployment/HOSTING_GUIDE.md` for the full migration, Gmail, mobile and rollback instructions.

## Information still needed to go online

The owner needs to select the hosting provider/region, domain, spending limit, MongoDB destination and Gmail sender. Enter credentials privately in the host's settings. Public release follows completion of the actual host acceptance checks.
