# Supplied Word guide — requirement coverage

Scope follows the user's explicit MERN-only and real-Gmail requirements. Database collections replace the guide's SQL tables. The Django example folder tree is not used. Core modules are implemented; future enhancements are tracked separately below.

| Word guide requirement | Implementation |
| --- | --- |
| Register, login, logout | Existing React authentication pages and protected Express routes; logout is available on Dashboard |
| Forgot/change password | Existing Gmail token flows and password rules |
| Update profile | `/profile`, PATCH `/api/profile`; username, mobile, address; verified email is retained |
| Add/view/edit/delete vehicle | Existing `/vehicles` forms, archive and restore; registration is immutable after creation to protect records |
| Vehicle fields and validation | Registration, make/brand, model, year, fuel type; duplicate protection and year validation |
| Book service/date/time/description | Existing `/book-service`; capacity and duration-aware availability, workshop time zone and notes |
| General service | Seeded Periodic Maintenance |
| Oil change | Seeded Oil and Filter Change |
| Brake service | Seeded Brake Inspection |
| AC service | Added AC Service |
| Wheel alignment | Seeded Wheel Alignment |
| Battery check | Seeded Battery and Electrical Check |
| Water wash | Seeded Vehicle Cleaning |
| Tyre replacement | Added Tyre Replacement |
| Customer booking history/status/cancel | Existing list/detail/history/cancellation with 15-second idle refresh |
| Admin dashboard | Existing workload, status and attention projections with idle refresh |
| View/manage customers | `/admin/customers`; filtered list, edits, activation/deactivation; deactivation is the account-removal mechanism and retains history |
| View/manage vehicles | Existing administrator vehicle list and customer vehicle management |
| Approve/reject/status updates | Existing guarded state machine: requested → confirmed → in_service → completed, plus rejection/cancellation/no-show branches |
| Delete bookings | Administrator terminal-record delete, reason and confirmation; transactional audit copy; no early completed-slot release |
| Customer booking/service reports | `/reports`; own booking records or completed service history only |
| Administrator customer/vehicle/booking/pending/completed reports | `/reports` or `/admin/reports`; filtered preview, full bounded CSV export, print displayed page |
| Home/About/Services/Contact | Public React routes; live MongoDB catalogue and environment-configured contact details |
| Registration mobile/password validation | Existing 10-digit mobile validation and strong password policy; backend validates profile changes too |
| No past booking dates | Existing booking horizon, lead time and capacity checks |
| Navbar/cards/tables/forms/badges/footer | Existing responsive custom CSS components plus new public/account/report views; Bootstrap is not added over the project's established CSS |
| Gmail emails | Existing immediate verification/reset; added booking/status notification outbox and delivery retry screen |
| Persistent records | Default local launcher uses a disk-backed MongoDB replica set |
| Documentation/deployment preparation | README, START_HERE, API/acceptance records and existing Docker/CI files; not deployed in this session |

## Guide's future enhancements

Online payments, SMS reminders, QR codes, mechanic assignment, spare-parts inventory, PDF invoices, recurring service reminders and a mobile app remain future scope. Booking-status email notifications are implemented now. CSV downloads and browser printing are implemented; PDF invoice generation is not claimed.

## Verification boundaries

The automated React tests use JSDOM, not a live browser. Full database integration and a persistent stop/restart test need MongoDB binaries. Real Gmail SMTP acceptance and mailbox receipt need the user's Gmail credentials and network access. See the release verification record for the checks actually run.
