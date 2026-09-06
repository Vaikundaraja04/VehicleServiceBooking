# Vehicle Service Booking — Complete MERN Hosting and Mobile Guide

**Prepared:** 6 September 2026  
**Project:** Existing VehicleServiceBooking application  
**Purpose:** Explain the complete path from the current local project to an internet-accessible website for mobile and desktop users.  
**Status:** The owner approved local hosting preparation after reviewing the original guide. Production API addressing, configuration checks and Linux deployment templates are now included. No public hosting, purchase, DNS change, live migration or real email delivery has been performed.

For the implemented setup, start with `deploy/README.md` in the project ZIP. Detailed check results and remaining launch gates are recorded in `docs/deployment/VERIFICATION.md`.

## 1. What you will get after an approved deployment

Customers and administrators will open one HTTPS website address from a phone, tablet or computer. Customers can register, verify their email, manage vehicles, request service appointments and check booking status. Administrators can manage the workshop through their own protected account.

The application remains **MongoDB + Express + React + Node.js**. A different backend framework or database is unnecessary.

Once the application runs on a hosting server, your personal computer does not have to remain switched on. The hosting server and database must remain available. Mobile users will use their normal internet connection.

A mobile-friendly website does not automatically provide an Android APK, iOS app, offline bookings or push notifications. Those would be separate additions requiring approval.

## 2. Current project: what the source actually contains

The following describes the inspected source, rather than claiming that every feature has passed a public production test.

| Area | Existing functionality |
| --- | --- |
| Accounts | Registration, email verification, login/logout, password reset/change and profile editing |
| Customer vehicles | Create, edit, archive and restore vehicles |
| Services | Public service list and administrator catalogue management |
| Booking | Availability, request creation, cancellation and appointment history |
| Administrator | Booking approval/rejection, status changes, customer management and workshop settings |
| Reports | Customer and administrator reports, CSV export and print views |
| Email | Gmail authentication messages and a database-backed booking notification queue |
| Record deletion | Eligible terminal bookings can be removed with an administrator reason and retained audit copy |
| Refresh | Selected screens refresh approximately every 15 seconds while visible and idle |
| Mobile groundwork | Viewport metadata and responsive CSS rules are present; real-device acceptance remains necessary |

The refresh behavior is polling, not a WebSocket connection. Background tabs and active form controls can pause refresh. Booking email delivery is also asynchronous.

The workshop timezone is currently `Asia/Kolkata`. Deploying the server in another country must not silently change appointment times.

## 3. Recommended hosting arrangement

**Proposed default:** One HTTPS domain, a Linux server running Nginx and the Node application, and a managed MongoDB replica set such as MongoDB Atlas.

This is an engineering recommendation for the existing code. It is not a selected or purchased hosting plan.

```mermaid
flowchart TD
    M["Mobile browser"] --> P["Nginx: HTTPS domain"]
    D["Desktop browser"] --> P
    P --> F["React static files"]
    P --> A["Express API: /api"]
    A --> B["Managed MongoDB"]
    A --> E["Gmail SMTP"]
```

| Component | Proposed responsibility |
| --- | --- |
| Domain and DNS | Give users one memorable public address |
| Nginx | Terminate HTTPS, serve React files and proxy `/api` requests |
| Node.js process | Run the Express API and the existing email worker continuously |
| Managed MongoDB | Store persistent records and support booking transactions |
| Gmail | Send real verification, reset and booking emails |
| Process supervisor | Restart the Node process after failure or server reboot |

Nginx and the process supervisor are hosting infrastructure. The application remains MERN.

Example URL mapping; `booking.example.com` is a placeholder, not a live site:

| Purpose | Example address |
| --- | --- |
| Website | `https://booking.example.com` |
| API | `https://booking.example.com/api` |
| API health | `https://booking.example.com/api/health` |
| Administrator queue | `https://booking.example.com/admin/bookings` |
| Booking details | `https://booking.example.com/bookings/<booking-id>` |

### Why use one domain?

The existing `vsb_auth` cookie is `HttpOnly`, uses `SameSite=Lax`, and becomes `Secure` in production. A single origin lets the current browser requests and cookie authentication work together without introducing a cross-site arrangement.

Hosting the frontend and API on unrelated provider domains can prevent cookies from accompanying cross-site requests. A CORS setting alone does not override cookie restrictions. Do not change the cookie to `SameSite=None` as a shortcut; that would need a separate authentication and CSRF review. [MDN: Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)

A managed Node platform is another possible choice, provided it supports the required domain routing, continuous process execution, MongoDB connectivity and Gmail SMTP. Exact provider configuration must be decided after selecting the host.

## 4. Decisions to approve before implementation

| Decision | Proposed starting point | Approval status |
| --- | --- | --- |
| Hosting method | Linux server, Nginx and a supervised Node process | Pending |
| Hosting provider and region | Select after checking requirements and price | Pending |
| Domain | Use an existing domain or approve a new one | Pending |
| MongoDB | Managed replica-set deployment | Pending |
| Existing data | Preserve current users, vehicles and bookings | Pending confirmation of migration scope |
| Gmail sender | Use an owner-controlled Gmail account | Pending configuration |
| First administrator | Owner chooses the account identity | Pending |
| Budget | Obtain a current quote before purchases | Pending |
| Public launch | Release after acceptance checks | Pending |

Hosting, database, domain renewal and backup costs depend on the selected plans. No free, unlimited or always-on entitlement is assumed. Check current renewal prices, taxes, usage limits, SMTP restrictions and backup availability before approval.

## 5. Prerequisites

- Access to the latest project source, including the booking queue fix.
- A backup of the current database on the user's computer.
- A hosting account controlled by the owner.
- DNS control for the chosen domain.
- A MongoDB deployment supporting transactions.
- A dedicated database user with access limited to the application database.
- An eligible Gmail sender account and Google App Password.
- Node.js **24.x**, matching the project's `>=24 <25` requirement.
- An Android or iPhone browser and a desktop browser for acceptance testing.

Install dependencies from the existing lockfiles. The current source pins React 19.2.8, Vite 8.2.2 and Mongoose 9.9.4; these are project versions, not a claim about the latest releases. Do not combine deployment with an untested dependency upgrade.

For a managed platform, verify that outbound Gmail SMTP is supported before selecting the plan. The current Gmail transport uses the Gmail service preset, and the project's diagnostic checks SMTP port 465.

## 6. Prepare the deployment package

After approval:

1. Work from a copy of the latest source.
2. Retain `client/package-lock.json` and `server/package-lock.json`.
3. Install fresh dependencies on the build/hosting environment; do not copy Windows `node_modules` to Linux.
4. Include the client source, server source and required root `scripts` directory.
5. Exclude real environment files, database files, backups, generated administrator documents and local dependencies from any public repository or web root.
6. Serve only the generated `client/dist` directory as frontend content.
7. Keep a record of the release version and retain the previous release for rollback.

Existing Docker Compose configuration is a local setup, not a production deployment template. It publishes the MongoDB port and does not define the complete authenticated, backed-up production database arrangement. Do not expose it unchanged on the internet.

## 7. Environment configuration

The examples below are documentation templates. They have not been written into application configuration. Replace every placeholder privately before use.

### Backend: same-server Nginx deployment

```dotenv
NODE_ENV=production
PORT=5000
HOST=127.0.0.1
CLIENT_URL=https://booking.example.com
MONGO_URI=<private-managed-mongodb-connection-string-with-database-name>
JWT_SECRET=<private-random-secret-at-least-32-characters>
JWT_EXPIRES_IN=8h
GMAIL_USER=<sender-address@gmail.com>
GMAIL_APP_PASSWORD=<16-character-google-app-password>
TRUSTED_PROXY_IPS=loopback
WORKSHOP_NAME=<workshop-name>
WORKSHOP_EMAIL=<public-contact-email>
WORKSHOP_PHONE=<public-contact-number>
WORKSHOP_ADDRESS=<public-contact-address>
```

| Variable | Exact requirement for this project |
| --- | --- |
| `NODE_ENV` | Use `production` for the public installation |
| `PORT` | Integer from 1 to 65535; 5000 is the proposed private upstream port |
| `HOST` | `127.0.0.1` when Nginx is on the same server; managed platforms may require `0.0.0.0` |
| `CLIENT_URL` | Exact frontend origin, including `https://`, without a trailing slash or `/api` |
| `MONGO_URI` | Real authenticated MongoDB URI pointing to the chosen application database |
| `JWT_SECRET` | A new private random value; placeholder values are rejected |
| `JWT_EXPIRES_IN` | Must remain exactly `8h`; the current validator requires it |
| Gmail variables | Sender account credentials; never frontend configuration |
| `TRUSTED_PROXY_IPS` | Only verified proxy IPs, supported CIDRs or `loopback`; the app does not accept `true` or a hop count here |
| Workshop variables | Optional public contact information |

Use the hosting secret manager or a protected environment file outside the public directory. Keep one authoritative production configuration. The Gmail diagnostic gives `server/.env` precedence over shell variables; shipping an old local file could make it test different credentials from those expected on the host.

For the proposed direct Nginx-to-Node arrangement, `loopback` is appropriate because Nginx connects locally. If a CDN or external load balancer is added, review the actual proxy chain before setting trusted addresses. [Express: behind proxies](https://expressjs.com/en/5x/guide/behind-proxies/)

### Frontend build configuration

For the single-origin arrangement, the existing API client supports:

```dotenv
VITE_API_URL=/api
```

The prepared production build now defaults to `/api`, so setting this variable is optional for the supplied Nginx arrangement. An explicit `VITE_API_URL` still overrides the default. Local development retains its localhost fallback. If an absolute API URL is required, use the actual public HTTPS API address, for example `https://booking.example.com/api` after replacing the example domain.

Vite replaces these values during the build. Changing a hosting variable after building does not update already-generated JavaScript; rebuild and redeploy the frontend. Every `VITE_` value is public. [Vite: environment variables](https://vite.dev/guide/env-and-mode)

## 8. Set up MongoDB

1. Create the approved managed deployment and application database.
2. Create a separate application database user.
3. Grant the permissions needed for application CRUD operations and index creation, scoped to the application database.
4. Allow connections from the backend server's outbound IP address or approved private network.
5. Store the connection string only in backend configuration.
6. Verify connection, model/index initialization and an actual booking transaction.

The phone connects to the API, not directly to MongoDB. It does not need to appear in the database IP access list. Atlas uses an IP access list to control database network access. [Atlas: IP access list](https://www.mongodb.com/docs/atlas/security/ip-access-list/)

This application creates bookings using MongoDB transactions. A standalone MongoDB process is insufficient; use a supported replica set or sharded deployment. [MongoDB: transactions](https://www.mongodb.com/docs/manual/core/transactions/)

Starting the server initializes model indexes, but that alone is not evidence that an imported database has the correct indexes. Inspect them and test concurrent booking conflicts before launch.

## 9. Preserve and migrate existing records

**Use the current database on the user's computer as the source of truth.** The database snapshot inspected in the uploaded ZIP contained no booking records and cannot stand in for bookings created afterward.

### Migration sequence

1. Identify the current database name, MongoDB port and record counts.
2. Take a restorable backup of the live source database.
3. Restore a rehearsal copy into an isolated destination and check compatibility.
4. Schedule the final cutover during a maintenance window.
5. Stop application writes and email processing while keeping the source database available for the final export.
6. Export the application database with MongoDB Database Tools.
7. Restore into an empty, approved destination database.
8. Preserve ObjectIds, dates, reference fields, password hashes, status histories and collection metadata/indexes.
9. Verify record counts, references, indexes, administrator access and representative bookings.
10. Point the hosted backend to the migrated database.
11. Complete private acceptance tests before enabling public use.

The local root launcher stops MongoDB along with the application. Do not stop that launcher and then expect an export against its port to succeed. The approved migration procedure must arrange for MongoDB to remain running while API writes and workers are stopped.

Use `mongodump` and `mongorestore` for a database migration; a report CSV is not a database backup. The exact commands depend on the chosen source, destination and authentication. Keep passwords out of command history and do not use destructive restore options against an occupied database without a reviewed plan. [MongoDB: mongodump](https://www.mongodb.com/docs/database-tools/mongodump/), [MongoDB: mongorestore](https://www.mongodb.com/docs/database-tools/mongorestore/)

### Special checks for imported email records

The existing mail queue stores complete email text, including the website URL at the time it was queued. Changing `CLIENT_URL` does not rewrite old queue items.

Before starting the hosted worker, inspect pending jobs for old `localhost` links and stale notifications. Prepare an approved migration decision for these jobs. Reissue expired verification/reset links through the normal flows when necessary. Starting `server/index.js` also starts its email worker; do not connect it to imported mail jobs before this review.

Do not run the disposable demo seed against the migrated database.

## 10. Build and start commands

These commands describe future execution after implementation approval. They were not run as deployment actions while producing this guide.

### Validate and build the frontend

Run from the project root:

```bash
cd client
npm ci
npm test -- --run
npm run lint
npm run build
```

Deploy the generated `client/dist` files. `vite preview` is a local preview tool, not the production web server. [Vite: static deployment](https://vite.dev/guide/static-deploy)

### Validate the backend separately

Run in a build/test environment, using an isolated test database:

```bash
cd server
npm ci
npm run lint
npm test
```

Do not point test tools at the production database. Database tests need their development dependencies and a MongoDB test replica set.

### Install production backend dependencies

In the deployment's `server` directory:

```bash
npm ci --omit=dev
```

### Seed the service catalogue when appropriate

With the intended backend environment configured:

```bash
npm run seed:booking
```

This existing command inserts missing default services by slug and ensures the workshop schedule exists. Review existing migrated data before running it. It does not create the first production administrator.

### Start the hosted API

From the `server` directory:

```bash
npm start
```

Equivalent process command:

```bash
node index.js
```

The root `npm start` runs the local launcher and is not the production start command. On a hosted platform, set the application root to `server`, or explicitly run `npm --prefix server start` from the project root.

The current email worker runs inside the Node process. Use a persistent process with automatic restart. Request-only functions or an idle service cannot be assumed to process its timer-based email queue continuously.

## 11. Keep the Node process running

For the proposed Linux server, use a service supervisor such as systemd. A sample unit is shown for review only:

```ini
[Unit]
Description=Vehicle Service Booking API
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=vsb
Group=vsb
WorkingDirectory=/srv/vehicle-service-booking/current/server
EnvironmentFile=/etc/vehicle-service-booking/server.env
ExecStart=/usr/bin/node index.js
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

Before using this template, provision the non-root `vsb` account, release directories and protected environment file. Verify the actual Node executable path. The environment file must use syntax compatible with systemd, including quoting values containing spaces. Do not assume Node installed in an interactive user's shell is available to systemd.

Service activation, reboot testing and any changes to server configuration require the owner's implementation approval. The proposed single Node instance also matches the app's current in-process authentication rate limiting; horizontal scaling would require review of shared rate-limit state and worker behavior.

## 12. HTTPS, reverse proxy and React routes

The following Nginx template assumes:

- Nginx connects directly to Node on the same server.
- The domain resolves to that server.
- A valid TLS certificate has already been issued.
- Only `client/dist` is served as static content.
- There is no additional CDN/load balancer in front of Nginx.

```nginx
server {
    listen 80;
    server_name booking.example.com;
    return 301 https://booking.example.com$request_uri;
}

server {
    listen 443 ssl;
    server_name booking.example.com;

    ssl_certificate /etc/letsencrypt/live/booking.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/booking.example.com/privkey.pem;

    root /srv/vehicle-service-booking/current/client/dist;
    index index.html;

    # Preserve /api in the upstream request path.
    location /api/ {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache off;
        add_header Cache-Control "no-store" always;
    }

    # Hashed build assets must never fall back to the React HTML document.
    location /assets/ {
        try_files $uri =404;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    location = /index.html {
        add_header Cache-Control "no-cache";
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Certificate paths are examples. Certificate issuance and automatic renewal must be configured for the selected host before enabling the HTTPS block.

The `proxy_pass` value deliberately has no trailing `/`: the Express routes include the `/api` prefix. React route fallback lets a direct visit or refresh at `/admin/bookings` load the application. [Nginx: proxy_pass](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass), [Nginx: try_files](https://nginx.org/en/docs/http/ngx_http_core_module.html#try_files)

After approval and setup, run `nginx -t` before reloading Nginx. Permit public HTTPS and the required certificate-validation traffic. Restrict administration access and keep the private Node upstream and database ports out of public exposure.

## 13. Gmail setup and acceptance

The existing implementation uses Gmail with an App Password. Use an eligible sender account with 2-Step Verification and store the App Password only in backend secrets. Availability of App Passwords depends on the account's settings. [Google: App Passwords](https://support.google.com/accounts/answer/185833)

From the project root, with the intended environment available:

```bash
npm run gmail:check
```

The success message means SMTP authentication succeeded. **This diagnostic does not send an email.** It does not prove delivery to a customer's inbox.

Actual acceptance must check:

1. A new customer's verification email arrives.
2. Its link uses the public HTTPS domain.
3. Verification completes and login succeeds.
4. Password reset arrives and the link works.
5. A new booking notification arrives.
6. An approved status change creates and delivers another notification.
7. Administrator delivery status and failed-job retry behave correctly.

The source polls queued notifications every 15 seconds and limits automatic attempts to five. Failures use increasing retry delays. A `sent` state means Gmail accepted the message, not guaranteed inbox placement. A crash after SMTP acceptance can cause a repeated notification.

Gmail may reject server sign-ins or enforce sending limits. Keep the requested Gmail integration, verify delivery from the selected host and reassess capacity before significant growth. [Nodemailer: Gmail](https://nodemailer.com/guides/using-gmail)

Administrator invitation links are manually shared by the administrator; the invitation creation action itself does not email the link. Acceptance subsequently uses the account verification flow.

## 14. First production administrator

**The Gmail sender is not automatically a production administrator.** That automatic creation belongs to the local launcher. Starting `server/index.js` on a host does not run the local bootstrap.

Choose one approved path:

| Situation | Action |
| --- | --- |
| Migrating an existing administrator | Preserve the account, password hash, role and verification state; test login |
| Fresh database | Use the existing first-admin document builder and privately insert the resulting document into the destination `users` collection |
| Additional administrators | Use the existing administrator invitation flow |

For a fresh database, the existing helper is:

```text
server/scripts/create-first-admin-document.js
```

It reads `ADMIN_USERNAME`, `ADMIN_EMAIL` and `ADMIN_PASSWORD`, hashes the password and prints an Extended JSON administrator document. **It does not insert the document into MongoDB.** Use the private procedure in `server/docs/authentication-manual-checks.md`, substituting the approved destination database for its local example. Check first that an administrator with that identity does not already exist.

Run this provisioning on a trusted machine using temporary environment values. Do not save generated password material, put it in the web root or include it in a repository. Ordinary public registration must continue to create customer accounts.

## 15. Mobile acceptance checklist

Responsive CSS exists, but mobile acceptance has not yet been performed against a hosted version.

| Check | Expected result |
| --- | --- |
| Android Chrome and iPhone Safari | Website loads with a valid HTTPS certificate |
| Mobile data with Wi-Fi disabled | Public website remains reachable |
| Login and reload | Session works and protected routes open correctly |
| Direct booking link from Gmail | Correct public route opens on the phone |
| Small widths: 360, 390 and 430 CSS pixels | Main content fits without unwanted page-wide horizontal scrolling |
| Forms and keyboard | Inputs, validation text and action buttons remain visible |
| Navigation | Customer and administrator menus are usable by touch |
| Booking dates and times | Same India-time appointment appears on phone and desktop |
| Status changes | Changes appear on another device after an eligible refresh |
| Reports | Tables remain usable; CSV download is tested separately from print |
| Slow network | Loading and error states are clear; duplicate submissions do not create duplicate bookings |
| Session separation | Different users remain separate; a customer's account cannot access administrator actions |

Start with portrait mode, then test landscape. Verify text zoom and readable labels. If any screen fails, prepare the smallest responsive changes for approval.

`localhost` on a phone means the phone itself. A link containing `localhost:5173` cannot reach the project on your computer through the public internet. Public use requires the deployed HTTPS address.

A home-screen shortcut may be available through the browser. Offline behavior, install prompts and push notifications are not promised by the current application.

## 16. End-to-end release checks

Run these on the proposed release with controlled test accounts before allowing public bookings.

- [ ] Frontend tests, lint and build pass.
- [ ] Backend tests and lint pass using isolated test data.
- [ ] `/api/health` returns HTTP 200 through the public domain.
- [ ] Frontend deep links reload correctly.
- [ ] Login cookie is `HttpOnly` and `Secure` over HTTPS.
- [ ] Registration, verification, login, logout and password reset work.
- [ ] A customer can create a vehicle and request an available appointment.
- [ ] Two customers cannot reserve the same bay and overlapping slot beyond capacity.
- [ ] Administrator approval, rejection and legal status transitions work.
- [ ] Customer cancellation honors ownership and timing rules.
- [ ] Renaming a customer does not break the administrator booking queue.
- [ ] Customer reports cannot expose another customer's records.
- [ ] Gmail messages arrive with usable public links.
- [ ] Reports, CSV downloads and supported printing work.
- [ ] Process restart and server reboot preserve records and resume the worker.
- [ ] A backup has been restored successfully into a separate database.
- [ ] Mobile data and real-phone checks pass.
- [ ] Owner approves public launch.

The existing `/api/health` route returns a static API-running message. It is a basic liveness check, not a continuous database or email readiness test. Include a database-dependent read and separate mail-queue inspection in operational checks.

## 17. Verification already completed in this conversation

The approved local hosting preparation has now been implemented and checked:

| Check | Recorded result |
| --- | --- |
| Full frontend suite | 45 test files, **990 tests passed** |
| Full backend suite | **650 tests passed**, using an isolated MongoDB replica set |
| Production configuration suite | **19 tests passed**, including rejection of unfilled templates and mismatched upstream ports |
| Frontend and backend lint | Passed |
| Frontend production build | Passed from clean source staging without local environment files |
| Production-mode API smoke | Real synthetic-user login, secure cookie attributes, authenticated queue and unauthenticated rejection passed |
| Username-change regression | Actual MongoDB booking creation, confirmation and rename produce a response accepted by the corrected queue validator |
| systemd syntax | Passed in a temporary copy using the test environment's Node executable; target paths still require validation |
| Exact booking in the screenshot | Not available in the uploaded database snapshot |
| Mobile visual preview | Attempted, but browser-environment port binding was blocked; not marked passed |
| Public hosting, Nginx and DNS | Not performed |
| Gmail delivery from the future host | Not performed |
| Real-phone production acceptance | Not performed |

See `docs/deployment/VERIFICATION.md` in the project ZIP for commands, limitations and the remaining acceptance steps. Automated success does not establish public deployment or real-device compatibility.

## 18. Troubleshooting after deployment

| Symptom | Likely checks |
| --- | --- |
| Phone tries to connect to localhost | Check the frontend build's `VITE_API_URL` and backend `CLIENT_URL` |
| Login succeeds but session disappears | Check HTTPS, cookie attributes, actual domain arrangement and credentialed requests |
| `Request origin is not allowed` | Match `CLIENT_URL` to the browser's exact origin |
| All users appear rate-limited together | Verify trusted proxy configuration and forwarded client IP handling |
| React page refresh returns 404 | Configure static-host SPA fallback for frontend routes |
| API request returns HTML | Ensure `/api/` reaches Express before React fallback |
| 502 Bad Gateway | Check Node service status, host binding and upstream port |
| MongoDB connection fails | Check URI, database user, outbound network and IP access list |
| Transaction error during booking | Verify that the database supports transactions |
| Gmail check passes but no message arrives | The check sends no mail; trigger the intended flow and inspect inbox, Spam and delivery state |
| Booking notifications remain queued | Check that the Node process is running and its email worker can connect to Gmail |
| Old localhost links appear in emails | Check `CLIENT_URL` and previously stored pending queue messages |
| Booking list says response invalid | Confirm the queue patch, then inspect the actual `/api/admin/bookings` JSON response |
| Data appears missing after deployment | Check the database name, URI and migration counts; do not reseed or delete records to hide the mismatch |

When sharing diagnostics, include status codes and relevant errors. Remove secrets, cookies, authorization headers and personal contact information. Preserve field structure and timestamps when diagnosing a malformed response.

## 19. Backup, updates and rollback

### Backup plan to approve

Define backup frequency, retention, access controls and an acceptable recovery point. Keep recoverable database backups separate from application release files. Confirm which backup facilities the selected database plan actually includes.

A downloaded source ZIP is not a backup of subsequent live bookings. Test restoration into a separate database and verify representative records, relationships and indexes.

### Application update procedure

1. Retain the working release and its matching frontend build.
2. Build and test the proposed release outside the live directory.
3. Back up data before any approved schema or migration change.
4. Deploy matching frontend and backend versions.
5. Restart the service and complete smoke tests.
6. Record the deployed version and observed results.

### Rollback procedure

If an application-only update fails, restore the previous matching frontend/backend release and recheck its compatibility with the current database. Preserve bookings accepted since the update.

Do not restore an older database merely to reverse a frontend bug. A database restore could discard newer customer activity. If database rollback is necessary, pause writes, identify affected records and obtain a reviewed recovery decision.

### Operations

Review API failures, database connectivity, pending/failed mail, disk usage and certificate renewal. Choose alert owners and cadence after approval. This document creates no scheduled monitoring, reminders or automatic tasks.

## 20. Implementation handoff and approval boundary

A developer following this document should:

1. Confirm the owner-selected domain, host, budget, Gmail sender and database migration scope.
2. Prepare concrete configuration and any necessary code changes for review.
3. Keep the existing MERN stack, booking integrity rules and Gmail requirement.
4. Validate a private release and show the results.
5. Obtain public-launch approval before making it publicly available.

The owner subsequently approved local implementation of this plan. That preparation is now included: same-origin production API defaults, the read-only preflight, Linux templates and updated documentation. The host, domain, budget, production database and Gmail sender still need to be selected or supplied before the corresponding external setup can be completed. No additional approval is needed to inspect the delivered files.

No hosting credentials need to be posted in chat. Use the approved host's private settings when implementation begins.

## 21. Source map

Project-specific statements were checked against:

| File | What it establishes |
| --- | --- |
| Root, client and server `package.json` | Node requirement, dependencies and supported commands |
| `server/config/env.js` | Required environment values and trusted-proxy validation |
| `server/app.js` | API prefixes, CORS, origin guard and health route |
| `server/index.js` | Database initialization, host binding and email worker startup |
| `server/utils/authCookie.js` | Cookie name, lifetime and production attributes |
| `client/src/api/authApi.js` | Development and production API defaults, overrides and credentialed fetch requests |
| `scripts/check-production.js` | Read-only production settings preflight |
| `deploy/README.md`, `deploy/linux/` | Concrete Linux, Nginx and systemd setup |
| `docs/deployment/VERIFICATION.md` | Current test evidence and remaining launch gates |
| `server/config/email.js` | Gmail transport |
| `server/services/bookingEmailService.js` | Notification queue, retry limits and stored links |
| `server/services/bookingService.js` | Booking transactions and lifecycle operations |
| `server/scripts/create-first-admin-document.js` | Production first-admin document helper |
| `server/scripts/seed-booking-foundation.js` | Default service catalogue seeding |
| `scripts/start-persistent.js` | Local launcher and persistence behavior |
| `client/src/hooks/useAutoRefresh.js` | Polling and pause behavior |
| `client/index.html`, `client/src/styles/index.css` | Mobile viewport and responsive rules |

Official technical documentation is linked next to the corresponding guidance above. Provider pricing, available plans and account eligibility must be checked when the owner selects the actual hosting arrangement.
