# Vehicle Service Booking Client

This is the React/Vite browser client for Vehicle Service Booking. It provides customer authentication and vehicle management, service discovery, booking creation, booking history and eligible cancellation, plus administrator invitation, read-only vehicle inspection, service catalogue, workshop schedule, booking queue, detail, and legal status-transition flows.

## Requirements

- Node.js 24 and npm
- The Vehicle Service Booking backend running at `http://localhost:5000`
- MongoDB available to, and configured for, the backend
- The backend's Gmail/email environment configured so verification and password-reset emails can be sent

The client defaults to `http://localhost:5000/api`. Copy the included `.env.example` to `.env` only when you need to document or change that public API origin. Change only `VITE_API_URL`. Do not put passwords, Gmail credentials, JWTs, or other secrets in that file: Vite exposes `VITE_*` values to the browser.

## Install and run

From this `client` directory:

```bash
npm ci
npm run dev
```

Keep the backend terminal running while using the client. `npm run dev` starts Vite exactly at `http://localhost:5173/` or stops with a port-in-use error. If that error occurs, close only the process that you recognize is using port `5173`, then run `npm run dev` again. Do not continue on another port: backend CORS and emailed links are fixed to `5173`.

Before testing customer booking locally, configure the backend environment for a non-production database and seed the booking foundation from the sibling `server` directory:

```bash
npm run seed:booking
```

The seed creates or preserves the default workshop schedule and six active services. It does not create a customer account or vehicle. Browser acceptance therefore also requires a verified customer with an active owned vehicle. The provided server `.env.example` is intentionally not a start-ready environment; supply valid local values without committing credentials.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Vite at exactly `http://localhost:5173/`; it stops if that port is unavailable. |
| `npm run build` | Create the production build in `dist/`. |
| `npm run preview` | Serve an already-built production build locally. |
| `npm test -- --run` | Run the complete test suite once. |
| `npm run lint` | Check source files with ESLint. |
| `npm audit --audit-level=high` | Check installed packages for high or critical advisories. |

Before handing off a change, run:

```bash
npm test -- --run
npm run lint
npm run build
npm audit --audit-level=high
```

## Routes

| Route | Use |
| --- | --- |
| `/` | Redirect to sign-in or the signed-in dashboard. |
| `/login`, `/register` | Customer sign-in and registration. |
| `/verify-email`, `/resend-verification` | Verification link completion and resend request. |
| `/forgot-password`, `/reset-password` | Password reset request and reset link completion. |
| `/dashboard`, `/change-password` | Signed-in account and password actions. |
| `/vehicles` | Customer-only owned vehicle management. |
| `/book-service` | Customer-only service discovery and four-step booking creation. |
| `/bookings` | Customer-only filtered and paginated booking list. |
| `/bookings/:id` | Customer-only booking detail, history, and eligible cancellation. |
| `/admin/vehicles` | Administrator-only customer vehicle list. |
| `/admin/services` | Administrator-only service catalogue management. |
| `/admin/schedule` | Administrator-only weekly hours, bays, and date overrides. |
| `/admin/bookings` | Administrator-only filtered booking queue. |
| `/admin/bookings/:id` | Administrator-only booking detail and legal status actions. |
| `/admin/invitations` | Administrator-only invitation creation. |
| `/admin/accept-invitation` | Administrator invitation acceptance link. |

My bookings requests 20 bookings per page and navigates only within the server-reported page range. The booking API rejects page numbers above 10,000 instead of accepting unbounded pagination input.

The backend email service creates verification, password-reset, and invitation links that open these routes. Open those localhost links on the same computer that is running the frontend. A link opened on a phone makes `localhost` refer to the phone, not this PC.

## Cookie and CORS security model

Authentication uses the backend's `HttpOnly` cookie. The client always sends requests with `credentials: "include"` and keeps only the safe user profile in React memory. It does not store or read JWTs, passwords, reset tokens, verification tokens, or invitation links in browser storage.

The browser frontend must use `http://localhost:5173`, and the backend must allow that exact origin with credentials. The client does not set the `Origin` header; the browser does so. Vite stops if `5173` is busy; close only the recognized process using `5173` and restart Vite. Backend CORS and email links expect that exact origin.

## Troubleshooting

- **The page cannot reach the API:** confirm the backend is running on port `5000`, then check `VITE_API_URL` (if set) and restart `npm run dev` after changing it.
- **A request is blocked by CORS or cookies do not persist:** confirm backend CORS permits `http://localhost:5173` with credentials and use matching HTTP/HTTPS settings during local development.
- **A verification/reset link does not work:** start both servers, then open the email link on the same PC that started the Vite server. Confirm the backend Gmail/email variables are configured.
- **Vite stops because port 5173 is in use:** close only the application or terminal you recognize is using `5173`, then run `npm run dev` again. Do not use another port because backend CORS and generated email links expect `5173`.
- **No booking services or slots appear:** run `npm run seed:booking` from `server`, confirm the backend uses the intended non-production database, and sign in as a verified customer with an active owned vehicle.

The commands above verify code and generate local build output, but do not by themselves prove real-browser acceptance, container execution, or production deployment readiness. See the repository's Gate 4 verification record and browser checklist for the latest executed evidence and remaining environment-dependent checks.
