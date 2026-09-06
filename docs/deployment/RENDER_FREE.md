# Vehicle Service Booking on Render Free

Prepared 6 September 2026. This guide applies after installing the Render update. It supplements the Linux VM hosting guide; use the commands here for Render.

## What the update changes

One Render Web Service runs Express and serves the built React site. Browser requests and email links use the same public HTTPS origin. A separate `start:render` command connects to Atlas, initializes database indexes, checks the Brevo sender, seeds the eight default services and workshop schedule, optionally creates the first administrator, and starts the booking email queue. Existing services and existing administrators are preserved. The local `npm start` and Gmail configuration remain available.

CSV exports also use the deployed API by default. Private configuration is entered in Render's Environment settings. The patch contains no real account passwords or API keys. The release check now matches the current public template and also rejects unapproved Brevo API key assignments.

## 1. Apply the update to the project already on GitHub

Save `VehicleServiceBooking-Render.patch` in your Windows Downloads folder. In PowerShell:

```powershell
Set-Location 'C:\Users\Durai\Music\VehicleServiceBooking'
git status --short
git apply --check "$env:USERPROFILE\Downloads\VehicleServiceBooking-Render.patch"
```

The status should show no local changes and the check should finish without an error. If it reports a conflict, share the error before proceeding. This patch is based on the clean release you just uploaded. It does not require `git init` or adding the remote again.

Then run each command, continuing only when the preceding command succeeds:

```powershell
git apply "$env:USERPROFILE\Downloads\VehicleServiceBooking-Render.patch"
git add package.json server scripts/release-verify.sh client/src/utils/downloadReport.js client/src/utils/downloadReport.test.js docs/deployment/RENDER_FREE.md
git commit -m "Prepare Render hosting and HTTPS email"
git push
```

Refresh GitHub and check that `server/start-render.js` exists. Your original ZIP checksum manifest describes the original download, not the patched working tree.

## 2. Set up the email account

Render Free blocks outbound SMTP ports 25, 465 and 587. Gmail SMTP from the local project therefore cannot be used on this plan. This update supports the Brevo HTTPS API. [Render Free limits](https://render.com/docs/free).

Brevo currently offers 300 email sends per day on its Free plan with no card or time limit. This includes transactional email. Account eligibility and activation still apply. [Brevo pricing](https://help.brevo.com/hc/en-us/articles/208589409-About-Brevo-s-pricing-plans).

1. Open [Brevo signup](https://onboarding.brevo.com/) and choose the Free plan.
2. Complete account verification and any transactional email activation requested by Brevo.
3. Add a sender: name `Vehicle Service Booking`, email an address you own. Complete its email verification.
4. Create an **API key** in Brevo's SMTP & API settings. The integration uses an API key, not an SMTP key.
5. Keep the key private and enter it only in Render as `BREVO_API_KEY`. Enter the verified sender email as `EMAIL_FROM`.

A Gmail sender can require email-code verification. Brevo may rewrite unauthenticated/free-domain senders to a provider domain; that is not a guarantee of permanent availability or inbox placement. If signup or sender activation is refused, resolve it before depending on hosted registration email. [Create a sender](https://help.brevo.com/hc/en-us/articles/208836149-Create-a-new-sender-From-name-and-From-email), [sender requirements](https://help.brevo.com/hc/en-us/articles/14925263522578-Comply-with-Gmail-Yahoo-and-Microsoft-s-requirements-for-email-senders).

The startup check verifies the API key and active sender using `GET /v3/senders`; it sends no email. A real registration/inbox check is still required after deployment. [Brevo sender API](https://developers.brevo.com/reference/get-senders).

## 3. Configure the Render form

| Field | Value |
|---|---|
| Service type | Web Service |
| Repository | `Vaikundaraja04/VehicleServiceBooking` |
| Name | `VehicleServiceBooking` (keep the current name) |
| Language | Node |
| Branch | `main` |
| Region | Singapore is a reasonable choice for your Mumbai database and Indian users |
| Root Directory | Leave empty |
| Build Command | `npm --prefix server ci --omit=dev && npm --prefix client ci --include=dev && npm --prefix client run build` |
| Start Command | `npm run start:render` |
| Compute | Free — $0/month |
| Health Check Path, if available | `/api/health` |

The root directory stays empty because the build needs both `client` and `server`. The default `yarn start` launches this project's local launcher. Use the dedicated Render command above. Singapore is one of Render's supported regions; changing the region after creation requires creating a new service. [Render regions](https://render.com/docs/regions).

## 4. Add environment variables privately

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `NODE_VERSION` | `24` |
| `MONGO_URI` | Your Atlas SRV URI, including a newly rotated database password and `/vehicle_service_booking` |
| `JWT_SECRET` | A fresh private random value; use the command below |
| `JWT_EXPIRES_IN` | `8h` |
| `EMAIL_PROVIDER` | `brevo` |
| `BREVO_API_KEY` | The private Brevo API key |
| `EMAIL_FROM` | Your verified Brevo sender email |
| `EMAIL_FROM_NAME` | `Vehicle Service Booking` |
| `BOOTSTRAP_ADMIN` | `true` for the first deployment only |
| `ADMIN_USERNAME` | `workshop_admin`, or your chosen username: 3–30 letters, digits, underscores |
| `ADMIN_EMAIL` | An email address you own for the administrator |
| `ADMIN_PASSWORD` | A new strong password with uppercase, lowercase and a number; 8–72 characters and at most 72 UTF-8 bytes |

Generate the JWT secret on your own PC, then paste the output only into Render:

```powershell
node -e "process.stdout.write(require('node:crypto').randomBytes(48).toString('hex'))"
```

Rotate the database password that appeared in your earlier screenshot before using it. A connection string template is:

```text
mongodb+srv://DATABASE_USER:URL_ENCODED_NEW_PASSWORD@YOUR_CLUSTER.mongodb.net/vehicle_service_booking?appName=VehicleServiceBooking
```

Replace placeholders privately. URL-encode special characters in the password. Keep it as one line. Do not add the URI or secret to the repository, frontend variables, screenshots, or chat.

Leave `VITE_API_URL`, `CLIENT_URL`, `HOST`, `PORT`, `SERVE_CLIENT`, `DEPLOYMENT_TARGET`, `TRUSTED_PROXY_IPS`, `GMAIL_USER` and `GMAIL_APP_PASSWORD` unset in Render. The startup sets the needed defaults. Render supplies `RENDER=true`, its `PORT` and `RENDER_EXTERNAL_URL`; the latter becomes the website/email origin. If you later attach a custom domain, set `CLIENT_URL` to its HTTPS origin without a trailing slash. [Render environment variables](https://render.com/docs/environment-variables).

This profile trusts one Render proxy hop for secure requests and rate limits, following Render's Express example. It is enabled only for the production Render entrypoint with Render's environment flag. Keep this profile on Render's managed ingress. [Render proxy example](https://render.com/articles/how-render-handles-ddos-attacks).

## 5. Create the service and allow it into Atlas

Once the patch is on GitHub and the environment values are entered, click **Deploy Web service** with **Free $0/month** still selected. This creates the service details page and starts its first deployment.

1. On that service's page, open **Connect → Outbound**.
2. Copy every displayed IP range.
3. In Atlas, open the project's **Network Access / IP Access List**. Add those ranges, one per entry.
4. Wait for Atlas to apply them. If the first deployment already failed to connect, use Render's **Manual Deploy → Deploy latest commit**.

The outbound ranges are available on the created service, so the first startup can fail until this step is complete. Use the ranges Render displays rather than opening Atlas to all internet addresses. [Render outbound addresses](https://render.com/docs/outbound-ip-addresses).

Atlas must have a database user whose credentials match the URI and whose permissions allow the application to read/write `vehicle_service_booking` and create its collections/indexes. Your laptop's IP entry alone does not permit Render to connect.

## 6. Check the first deployment

Wait for Render to show the deployment as Live, then use its actual HTTPS URL.

1. Open the site and sign in with `ADMIN_USERNAME` and `ADMIN_PASSWORD`.
2. Confirm that the service list contains the initial services.
3. Remove `BOOTSTRAP_ADMIN` and `ADMIN_PASSWORD` from Render after the administrator works; save the environment change. Restarting does not reset an existing administrator.
4. Register a test customer whose inbox you control. Open the verification email and verify the account.
5. Add a test vehicle and request a booking. Confirm it as administrator and check the customer's page and email.
6. Download a CSV report. It should come from the hosted site.
7. Test on a phone using the public HTTPS URL, including refreshing `/dashboard` directly. The PC does not need to remain on.

The new Atlas database starts with its own data. Local users and bookings are not automatically migrated. This update only adds the default service catalogue, schedule, and opt-in first administrator.

If startup fails, its log identifies the stage: build/Atlas, Brevo verification, initial data, administrator, or HTTP listener. Share the error text with secrets hidden. Common fixes are completing Atlas access, replacing the database password placeholder, activating the Brevo sender, or correcting the administrator fields. An existing customer with the requested admin email/username is never promoted automatically.

## Cost and verification limits

Keep Render Free and Atlas Free selected. Render Free sleeps after inactivity, so a first request may take about a minute to wake it. The email worker also pauses while the service sleeps; queued booking notifications resume while it runs. This setup is suitable for a small portfolio/demo, with usage limits, rather than guaranteed continuous service. There is no uptime ping workaround in this update. [Render Free limits](https://render.com/docs/free).

The update was checked with focused configuration, API, proxy, email, and bootstrap tests, a production frontend build, and an HTTP startup check using real local MongoDB. The HTTP check substituted the Atlas destination and Brevo responses with test boundaries; it did not send real email. Render's live ingress, your Atlas access, Brevo account acceptance, inbox delivery and phone behavior still require the checks above.

To undo an already committed update, use `git revert` on its update commit and push the revert. This does not remove data already created in Atlas. Do not reset or delete the Git repository.
