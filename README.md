# Vehicle Service Booking — MERN completion

For internet and mobile hosting, use **[deploy/README.md](deploy/README.md)**. For local use, start with **[START_HERE.md](START_HERE.md)**. The project keeps the uploaded MERN application and completes the remaining functional modules from the supplied Word guide. No SQL, Django or Python backend is used.

## Completed application

| Module | Capabilities |
| --- | --- |
| Accounts | Customer registration, Gmail verification, login/logout, password reset/change, profile editing |
| Customers | Administrator search, contact edits, account activation/deactivation and session revocation |
| Vehicles | Customer create/edit/archive/restore, duplicate registration checks, administrator listing |
| Services | Eight seeded services, administrator catalogue management and public browsing |
| Bookings | Capacity-aware slots, creation, approval/rejection, cancellation, service status, history, terminal-record deletion with audit copy |
| Workshop | Opening hours, date overrides, bay capacity and protected schedule changes |
| Reports | Customer booking/service history; administrator customer, vehicle, booking, pending and completed reports; CSV and print |
| Updates | Visible/idle customer booking detail, customer/admin lists and dashboards refresh every 15 seconds |
| Gmail | Immediate authentication emails; booking email queue, delivery state, bounded retries and administrator recovery controls |
| Public pages | Home, About, Services and configurable Contact page |
| Local startup | Persistent MongoDB replica set, real Gmail preflight and one-time local administrator creation |

## Run locally

Requires Node.js 24 and npm. Run `npm start` from the root, fill in the two Gmail values in the generated `server/.env`, then run `npm start` again. Open `http://localhost:5173`. The first run needs internet for dependencies and a MongoDB binary.

Use `GMAIL_USER` and the initial `ADMIN_PASSWORD` from `server/.env` to sign in as administrator. Register a separate real customer account and verify it through Gmail. Records persist in `.local/mongo`. The legacy `npm run demo` remains a disposable sample-data mode; use the default startup for this completed workflow.

## Architecture

React 19 / Vite 8 → credentialed Express 5 APIs on Node.js 24 → MongoDB replica set through Mongoose 9. Nodemailer connects only to Gmail SMTP. The original model/service/controller structure, immutable booking snapshots, role-specific serializers, cookie authentication, validation, bay-reservation unique index, transaction conflict handling and booking state machine are retained.

Booking deletion copies a terminal record to `DeletedBooking` and removes the operational record in a transaction. Customers cannot access administrator data or another customer's reports. Account deactivation retains history and invalidates old sessions. A deleted booking is excluded from normal reports, while its audit record remains in MongoDB.

Report dates use India time. Booking reports filter appointment dates; customer and vehicle lists filter record creation dates. CSV export includes all matching records up to 10,000; larger results must be filtered. Print covers the displayed page. Spreadsheet formula prefixes are escaped. The eight seeded services map to the guide's general, oil, brake, AC, alignment, battery, wash and tyre services; existing names are retained for six catalogue entries.

## Additional APIs

| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/public/services`, `/api/public/workshop` | Public |
| PATCH | `/api/profile` | Signed-in account |
| GET / PATCH | `/api/admin/customers`, `/api/admin/customers/:id` | Administrator |
| GET | `/api/reports?type=bookings&format=json` | Scoped by role |
| DELETE | `/api/admin/bookings/:id` | Administrator; reason required |
| GET | `/api/admin/email-deliveries` | Administrator |
| POST | `/api/admin/email-deliveries/:id/retry` | Administrator; failed delivery only |
| POST | `/api/admin/email-deliveries/bookings/:id/queue` | Administrator; idempotent queue recovery |

Existing API contracts remain documented in [Core booking API](docs/api/core-booking-api.md).

## External MongoDB / deployment

For an external database, configure `server/.env` directly with your authenticated MongoDB replica-set/Atlas URI, private JWT secret, Gmail account, and exact client URL. Start the API using `cd server` then `npm ci`, `npm run seed:booking`, and `npm start`. Start the client separately with `cd client`, `npm ci`, and `npm run dev`. Set `client/.env` from its example to your API URL. This path does not use the local launcher's MongoDB instance.

The existing Docker Compose setup provides a replica set and API; configure `server/.env`, then use `docker compose up --build mongo mongo-init api`. The client is a separate process. For production use `NODE_ENV=production`, HTTPS, appropriate proxy settings, and a same-site frontend/API arrangement for the existing SameSite cookie. Bootstrap the first administrator using the existing `server/scripts/create-first-admin-document.js` procedure in `server/docs/authentication-manual-checks.md` before sign-in. Never run the local sample-account seed against a hosted database.

This delivery is source code for a local runnable project, not a hosted production installation. Payments, SMS, mechanic assignment, inventory, QR codes and PDF invoices remain future enhancements as specified by the Word guide.

## Verification and Gmail limits

See [the release verification record](docs/release/mern-completion-verification.md) and [requirement coverage](docs/requirement-coverage.md). Real MongoDB integration, persistent restart behavior and real Gmail delivery need verification on a machine with the required network access and Gmail configuration. No screenshots or live email acceptance are fabricated.

Email queue insertion happens after the booking commits; a rare queue-insertion failure requires the administrator recovery action. Delivery retry after an interrupted SMTP acknowledgement can duplicate a notification. Administrator invitations retain the existing manual one-time-link workflow.

References: [Google App Passwords](https://support.google.com/accounts/answer/185833?hl=en), [Nodemailer Gmail](https://nodemailer.com/guides/using-gmail), [Mongoose transactions](https://mongoosejs.com/docs/transactions.html), [MongoDB local replica-set helper](https://typegoose.github.io/mongodb-memory-server/).
