# MERN project completion

Goal: complete the remaining functional requirements in the supplied Word guide, using the existing MongoDB, Express, React and Node.js application. Gmail is the only email transport. Preserve the existing booking capacity and authorization rules.

The source guide mixes Django and SQL examples with MERN. The user's explicit MERN-only instruction resolves this: no SQL database, Django or Python application code is introduced.

1. Account and customer operations: add validated profile editing, customer search, editing and activation/deactivation. Keep verified email and roles immutable through these endpoints. Deactivation invalidates sessions and retains service history.
2. Reports: add customer booking/service history and admin customer, vehicle, booking, pending and completed reports; paginate previews, bound exports, neutralize spreadsheet formulas and support printing.
3. Booking deletion: accept only terminal bookings, require a reason and explicit confirmation, retain an audit copy in MongoDB, and remove the operational record transactionally.
4. Public pages: implement Home, About, live Services and configurable Contact details. Preserve the existing blue/white theme and add profile/reports/customer navigation.
5. Automatic refresh: refresh booking lists, detail and dashboards every 15 seconds while visible and idle; skip open confirmations and forms. This is polling, not WebSockets.
6. Gmail: preserve authentication emails, add booking notification outbox, Gmail delivery worker, bounded retry and admin delivery visibility. Never simulate success. Require local Gmail configuration for the persistent run mode. No secrets in the delivered archive.
7. Startup and handoff: add a persistent local MongoDB replica-set launcher, keep the disposable demo command, and document Windows setup, real Gmail verification and requirement coverage.

Verification: write route/validation and CSV security regression tests before implementation; run lint, client tests and production build. Include MongoDB integration checks for account isolation, export scoping and deletion. Record any tests blocked by unavailable database binaries or Gmail credentials truthfully.
