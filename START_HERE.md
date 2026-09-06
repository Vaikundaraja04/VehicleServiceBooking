# Start the completed MERN project

This project uses MongoDB, Express, React and Node.js only. Gmail is the only email provider. Start with this guide; older documents under `docs/superpowers` describe earlier releases.

## 1. Extract and open

Extract the ZIP completely. Open the `VehicleServiceBooking` folder in Visual Studio Code. Install Node.js 24 with npm if it is not installed.

Open a terminal in the folder containing `package.json` and run:

```bash
npm start
```

On Windows you can also double-click `START_HERE_WINDOWS.bat`.

The first run installs the required packages and creates `server/.env`, including private random application and administrator passwords. It then stops so you can configure Gmail. Internet access is required for the first dependency and MongoDB binary downloads.

## 2. Configure your real Gmail account

Open `server/.env`. Set these two values locally:

```dotenv
GMAIL_USER=your-real-address@gmail.com
GMAIL_APP_PASSWORD=your16characterapppassword
```

Replace the example values with your own account details. Use a Google App Password, not the password you use to sign in to Gmail. Enable 2-Step Verification and create the App Password using [Google's official instructions](https://support.google.com/accounts/answer/185833?hl=en). Some managed or protected Google accounts do not offer App Passwords; use an eligible Gmail account for this project.

Do not put the Gmail App Password in a React file or send it in chat. The browser needs only its public API URL. All email is sent by the Node.js backend through Gmail SMTP. There is no fake mailbox, console-email transport or simulated successful delivery in the application.

For the Contact page, optionally fill in `WORKSHOP_NAME`, `WORKSHOP_EMAIL`, `WORKSHOP_PHONE` and `WORKSHOP_ADDRESS` in the same file. Empty contact values are shown as unavailable; the app does not invent business details.

## 3. Start again

```bash
npm start
```

Startup checks your Gmail SMTP connection, starts a local MongoDB replica set, seeds eight workshop services, creates your first local administrator if needed, and starts the API and React client.

Open [the local application](http://localhost:5173).

Administrator sign-in:

| Field | Value |
| --- | --- |
| Email | Your `GMAIL_USER` from `server/.env` |
| Password | The generated `ADMIN_PASSWORD` in `server/.env` |
| Username | `workshop_admin` by default |

The administrator is created once. Restarting does not reset an existing account or password. If you later change the account password in the application, use that new password. `ADMIN_PASSWORD` is a bootstrap value only.

Register a separate customer with a real email address, open the verification email, and then sign in. Use a different browser profile or an incognito window to keep the administrator and customer sessions separate.

## 4. Check the complete workflow

1. Customer: register, verify through Gmail, sign in and update My profile.
2. Customer: add a vehicle, choose a service and available slot, and submit a booking.
3. Administrator: open Booking queue, approve the request, and inspect Email deliveries.
4. Customer: keep the booking page open. It refreshes about every 15 seconds while visible and idle. Editing a field or opening a cancellation confirmation pauses refresh.
5. At the allowed appointment time, the administrator can move the booking to In service, then Completed. The system intentionally rejects early or illegal transitions.
6. Customer: open Reports for booking history and completed-service history. Download CSV or print the displayed report page.
7. Administrator: use Customers, Reports, services and schedule management. Delete only finished/cancelled/rejected/no-show records, with a reason; a MongoDB audit copy is retained. Completed records cannot be deleted before their reserved interval ends.
8. Stop with Ctrl+C, start again and confirm your records remain.

## Gmail behavior

Verification and password-reset emails are sent immediately. Booking creation and each status change enqueue a Gmail notification. The worker checks the queue every 15 seconds and retries failures up to five times with increasing delays. Administrators can inspect the latest 100 deliveries and retry failed items after fixing Gmail configuration.

`Sent` means Gmail accepted the recipient; it is not proof that the message reached the inbox. Check Spam as well. Authentication emails are not listed in the booking-delivery screen. Administrator invitations retain the existing one-time-link workflow: copy the protected invitation link to the intended administrator; they are not automatically emailed.

A booking remains saved if notification queue insertion fails. The API returns `X-Booking-Email: queue-failed` and logs a safe error. Use **Check notification queue** on its administrator detail page to retry queue insertion. Normal duplicate queue requests do not create duplicate emails. A process crash after SMTP acceptance but before recording success can cause a retry email; delivery is not exactly-once.

To check Gmail authentication without sending any email:

```bash
npm run gmail:check
```

### Verification email missing

The sign-in error **Email verification is required** means the account still needs verification; it does not establish whether Gmail delivered the message.

1. In the project root terminal, run `npm run gmail:check`. It checks the sender credentials in `server/.env` without sending mail. `GMAIL_CONFIG` means the settings are missing or invalid; `EAUTH` means Gmail rejected the credentials; timeout, DNS or connection codes indicate a connection problem. Only safe diagnostic text is printed.
2. Set `GMAIL_USER` to the Gmail account sending the email. Set `GMAIL_APP_PASSWORD` to the 16-character Google App Password created for that same account. The customer's registration email is the recipient; it can be a different account.
3. After changing `server/.env`, stop the running app with Ctrl+C and run `npm start` from the project root. Use the persistent launcher for real Gmail.
4. Open [Resend verification email](http://localhost:5173/resend-verification), enter the exact email used during registration (not a username such as `raja`), and submit once. After reaching the resend limit, wait for the page's rate-limit guidance before trying again.
5. In that recipient's Gmail, search `in:anywhere subject:"Verify your Vehicle Service Booking email"`. Open the newest verification link within 60 minutes, then sign in. Requesting another link invalidates the earlier link.

The resend success message is deliberately generic for account privacy: a mistyped or unregistered address also receives that message. Confirm the address you originally registered. If the page reports **Verification email could not be sent**, resolve the Gmail check failure and resend. SMTP authentication success alone does not prove inbox delivery. Share the check's final message and the resend page message when requesting help; never share your `.env`, passwords or verification link.

### Applying the Gmail troubleshooting update

Stop the app first. Copy the updated source files into your existing project, keeping your local `server/.env` and `.local/mongo`. The ZIP does not contain either of these. Run `npm start` again. Do not run the legacy disposable demo when testing existing customer accounts.

## Data and troubleshooting

Local records are stored in `.local/mongo`, using MongoDB on port 27019. Keep that folder when upgrading. The local launcher binds MongoDB and the API to your own computer and is intended for local learning and demonstration. For a hosted installation, use an authenticated MongoDB replica set or Atlas, HTTPS, a Node host, and the advanced configuration in the README.

| Problem | Action |
| --- | --- |
| Node version error | Install Node.js 24, reopen your terminal, and run again. |
| Gmail authentication fails | Recheck your email and App Password; ensure 2-Step Verification is enabled. |
| Port is already in use | Close the previous instance using ports 5000, 5173 or 27019. |
| MongoDB download is blocked | Allow the official MongoDB download on your machine, or use the advanced external MongoDB setup. |
| Verification email did not arrive | Check Gmail settings and Spam, then use Resend verification. |
| Booking action is unavailable | Check the appointment time and allowed status flow. |
| Data disappeared using `npm run demo` | That legacy command intentionally uses a disposable database. Use `npm start` for persistent records and real Gmail. |

## Verification commands

```bash
npm run test:launcher
npm run test:unit
cd client
npm test -- --run
npm run lint
npm run build
cd ../server
npm run test:all
```

The database tests require a downloadable MongoDB binary. The handoff's exact checks and limitations are in `docs/release/mern-completion-verification.md`.
