# Authentication Manual Checks

Run every command from `<project-root>\server` in Windows PowerShell. Keep the backend open in one PowerShell window and run API commands in a second window.

Record only `PASS` or `FAIL` for each section. Never paste or share `.env`, a Gmail App Password, a JWT cookie, a normal password, a password hash, or a complete usable token in chat, screenshots, issue trackers, or Git. Do not save generated administrator JSON. Enter secrets only in the local prompts and local `.env` described below.

## Before you start: local MongoDB replica set and Gmail

Open PowerShell and move to the backend directory:

```powershell
Set-Location "<project-root>\server"
Get-Service -Name MongoDB
Test-NetConnection -ComputerName 127.0.0.1 -Port 27017
```

Required: `Get-Service` shows `Running`, and `Test-NetConnection` shows `TcpTestSucceeded : True`. If the service is installed but stopped, open PowerShell as Administrator once, run `Start-Service -Name MongoDB`, close that administrator window, and repeat the two checks in a normal window.

Booking transactions require a single-node replica set named `rs0`; a standalone MongoDB server is not sufficient. Configure the local `mongod` service with `replication.replSetName: rs0` (or start it with `--replSet rs0`), restart the service, then initialize it once from a normal PowerShell window:

```powershell
mongosh --host 127.0.0.1 --port 27017 --eval "rs.initiate({_id: 'rs0', members: [{_id: 0, host: '127.0.0.1:27017'}]})"
mongosh --host 127.0.0.1 --port 27017 --eval "rs.status().set"
```

Required: the second command prints `rs0`. If initialization reports that the replica set is already initialized, leave its existing configuration in place and confirm its name is `rs0`.

Use a Gmail account with two-step verification and a Gmail App Password.

Generate a private JWT secret locally first. Keep the output in this PowerShell window and do not paste it into chat, screenshots, source control, or documentation:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

Then open the ignored local environment file with:

```powershell
notepad .env
```

Replace the bracketed `JWT_SECRET` value with the generated output before startup. The value in `.env.example` is intentionally invalid so a copied template fails closed.

Keep these names and use your own private local values for the bracketed entries:

```dotenv
PORT=5000
MONGO_URI=mongodb://127.0.0.1:27017/vehicle_service_booking?replicaSet=rs0
CLIENT_URL=http://localhost:5173
JWT_SECRET=<private-random-value-at-least-32-characters>
JWT_EXPIRES_IN=8h
GMAIL_USER=<your-gmail-address>
GMAIL_APP_PASSWORD=<your-gmail-app-password>
NODE_ENV=development
```

Do not put quotes around the values. Do not use a normal Gmail password. Save `.env` locally, then verify that Git ignores it:

```powershell
git check-ignore .env
git status --short -- .env
```

Required: the first command prints `.env`; the second command prints nothing. The automated tests set `MONGO_URI` to `mongodb://127.0.0.1:27017/vehicle_service_booking_test?replicaSet=rs0` themselves, so they never use or clear `vehicle_service_booking`.

## 1. Automated gate

Make sure local MongoDB is running, then run:

```powershell
npm test
npm audit
npm ls bcryptjs cookie-parser cors dotenv express express-rate-limit express-validator helmet jsonwebtoken mongoose nodemailer supertest
git status --short
```

Required:

- The final `npm test` summary contains `# fail 0`; the total test count equals the pass count.
- `npm audit` prints `found 0 vulnerabilities`.
- Every named package appears under `server@1.0.0`; none is marked `(empty)`, `invalid`, or `UNMET DEPENDENCY`.
- `.env` and `node_modules` do not appear in `git status --short`.

Stop here if any automated check fails.

## 2. Start the backend and check health

In the first PowerShell window:

```powershell
npm start
```

Required startup message:

```text
Server is running on http://localhost:5000
```

Leave that window running. In the second PowerShell window:

```powershell
Set-Location "<project-root>\server"
$health = Invoke-RestMethod -Uri http://localhost:5000/api/health
$health.message
```

Required output:

```text
Vehicle Service Booking API is running
```

## 3. Real Gmail verification and password reset

Use these input rules for every account created below:

- Username: 3–30 letters, numbers, or underscore characters only. It is saved in lowercase.
- Password: 8–72 characters, no more than 72 UTF-8 bytes, with at least one uppercase letter, one lowercase letter, and one number. An ASCII-only password is easiest for this manual check because every character is one byte.

Choose a Gmail inbox you can open and a new username. PowerShell hides the password while you type it:

```powershell
$customerEmail = Read-Host "Customer email"
$customerUsername = Read-Host "Unique customer username"
$secureCustomerPassword = Read-Host "Customer password" -AsSecureString
$customerPassword = [System.Net.NetworkCredential]::new("", $secureCustomerPassword).Password
$registrationBody = @{
  username = $customerUsername
  email = $customerEmail
  mobile = "9876543210"
  address = "Chennai"
  password = $customerPassword
} | ConvertTo-Json
$registrationResponse = Invoke-WebRequest -UseBasicParsing -Method Post -Uri http://localhost:5000/api/auth/register -ContentType "application/json" -Headers @{ Origin = "http://localhost:5173" } -Body $registrationBody
$registration = $registrationResponse.Content | ConvertFrom-Json
$registrationResponse.StatusCode
$registration.emailSent
```

Required output: status `201`, `emailSent` is `True`, and the customer Gmail inbox receives exactly one message with subject `Verify your Vehicle Service Booking email`. The response must not contain a token or password hash.

Confirm that login is blocked before verification:

```powershell
$blockedLoginBody = @{ identifier = $customerEmail; password = $customerPassword } | ConvertTo-Json
try {
  Invoke-RestMethod -Method Post -Uri http://localhost:5000/api/auth/login -ContentType "application/json" -Headers @{ Origin = "http://localhost:5173" } -Body $blockedLoginBody
  throw "FAIL: unverified login unexpectedly succeeded"
} catch {
  if ([int]$_.Exception.Response.StatusCode -ne 403) { throw }
  "PASS: unverified login returned 403"
} finally {
  $blockedLoginBody = $null
}
```

The React verification page is outside this backend scope. In Gmail, open the message and copy only the 64-character value after `token=`. Paste it only into this local hidden prompt:

```powershell
$secureVerificationToken = Read-Host "Verification token from Gmail link" -AsSecureString
$verificationToken = [System.Net.NetworkCredential]::new("", $secureVerificationToken).Password
$verifyBody = @{ token = $verificationToken } | ConvertTo-Json
$verified = Invoke-RestMethod -Method Post -Uri http://localhost:5000/api/auth/verify-email -ContentType "application/json" -Headers @{ Origin = "http://localhost:5173" } -Body $verifyBody
$verified.message
try {
  Invoke-RestMethod -Method Post -Uri http://localhost:5000/api/auth/verify-email -ContentType "application/json" -Headers @{ Origin = "http://localhost:5173" } -Body $verifyBody
  throw "FAIL: verification token was accepted twice"
} catch {
  if ([int]$_.Exception.Response.StatusCode -ne 400) { throw }
  "PASS: second verification use returned 400"
}
$verificationToken = $null
$secureVerificationToken = $null
$verifyBody = $null
```

Required: the first call prints `Email verified successfully. You can now log in.` and the second use returns `400`.

Request a real password-reset email:

```powershell
$forgotBody = @{ email = $customerEmail } | ConvertTo-Json
$forgot = Invoke-RestMethod -Method Post -Uri http://localhost:5000/api/auth/forgot-password -ContentType "application/json" -Headers @{ Origin = "http://localhost:5173" } -Body $forgotBody
$forgot.message
```

Required output: `If an eligible account exists, a password reset email has been sent.` Gmail receives one message with subject `Reset your Vehicle Service Booking password`. The response does not reveal whether an account exists and contains no token.

Copy only the 64-character `token=` value from that Gmail link and enter it at the local hidden prompt. Choose a new password different from the registration password:

```powershell
$secureResetToken = Read-Host "Reset token from Gmail link" -AsSecureString
$resetToken = [System.Net.NetworkCredential]::new("", $secureResetToken).Password
$secureNewCustomerPassword = Read-Host "New customer password" -AsSecureString
$newCustomerPassword = [System.Net.NetworkCredential]::new("", $secureNewCustomerPassword).Password
$resetBody = @{ token = $resetToken; newPassword = $newCustomerPassword } | ConvertTo-Json
$reset = Invoke-RestMethod -Method Post -Uri http://localhost:5000/api/auth/reset-password -ContentType "application/json" -Headers @{ Origin = "http://localhost:5173" } -Body $resetBody
$reset.message
try {
  Invoke-RestMethod -Method Post -Uri http://localhost:5000/api/auth/reset-password -ContentType "application/json" -Headers @{ Origin = "http://localhost:5173" } -Body $resetBody
  throw "FAIL: reset token was accepted twice"
} catch {
  if ([int]$_.Exception.Response.StatusCode -ne 400) { throw }
  "PASS: second reset use returned 400"
}
$resetToken = $null
$secureResetToken = $null
$resetBody = $null
```

Required: the first call prints `Password reset successful. Log in again.` and the second use returns `400`.

## 4. Cookie login, protected profile, role check, and logout

Log in with the new customer password. `WebRequestSession` keeps the `HttpOnly` cookie without printing its value:

```powershell
$loginBody = @{ identifier = $customerEmail; password = $newCustomerPassword } | ConvertTo-Json
$customerSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$login = Invoke-RestMethod -Method Post -Uri http://localhost:5000/api/auth/login -ContentType "application/json" -Headers @{ Origin = "http://localhost:5173" } -Body $loginBody -WebSession $customerSession
if ($login.PSObject.Properties.Name -contains "token") { throw "FAIL: login JSON exposed a token" }
$login.message
$me = Invoke-RestMethod -Method Get -Uri http://localhost:5000/api/auth/me -WebSession $customerSession
$me.user | Select-Object username, email, role, isEmailVerified, isActive
```

Required: login prints `Login successful`; its JSON has no token. `/me` shows the expected customer, `role` is `customer`, and `isEmailVerified` and `isActive` are `True`. It contains no `passwordHash`, `tokenHash`, or `tokenVersion`.

Confirm that a customer cannot create an administrator invitation:

```powershell
$roleCheckBody = @{ email = "role-check@example.com" } | ConvertTo-Json
try {
  Invoke-RestMethod -Method Post -Uri http://localhost:5000/api/admin/invitations -ContentType "application/json" -Headers @{ Origin = "http://localhost:5173" } -Body $roleCheckBody -WebSession $customerSession
  throw "FAIL: customer created an administrator invitation"
} catch {
  if ([int]$_.Exception.Response.StatusCode -ne 403) { throw }
  "PASS: customer invitation attempt returned 403"
}
```

Log out and confirm that the cleared cookie no longer opens `/me`:

```powershell
$logout = Invoke-RestMethod -Method Post -Uri http://localhost:5000/api/auth/logout -Headers @{ Origin = "http://localhost:5173" } -WebSession $customerSession
$logout.message
try {
  Invoke-RestMethod -Method Get -Uri http://localhost:5000/api/auth/me -WebSession $customerSession
  throw "FAIL: /me remained available after logout"
} catch {
  if ([int]$_.Exception.Response.StatusCode -ne 401) { throw }
  "PASS: /me returned 401 after logout"
}
$customerPassword = $null
$secureCustomerPassword = $null
$newCustomerPassword = $null
$secureNewCustomerPassword = $null
$registrationBody = $null
$blockedLoginBody = $null
$loginBody = $null
```

Required: logout prints `Logout successful`, and the next `/me` request returns `401`.

## 5. First administrator and manual-copy invitation

Restart the backend before this section so the local in-memory login limiter is fresh: press `Ctrl+C` in the first PowerShell window, run `npm start` again, and wait for `Server is running on http://localhost:5000`. Do not repeat failed passwords; the maximum allows five login requests within 15 minutes, and the sixth request is blocked with `429`.

Choose a username and email not used by the customer. Follow the username and password rules from section 3. Generate the first administrator document without putting the password in command history:

```powershell
$adminUsername = Read-Host "First admin username"
$adminEmail = Read-Host "First admin email"
$secureAdminPassword = Read-Host "First admin password" -AsSecureString
$adminPassword = [System.Net.NetworkCredential]::new("", $secureAdminPassword).Password
$env:ADMIN_USERNAME = $adminUsername
$env:ADMIN_EMAIL = $adminEmail
$env:ADMIN_PASSWORD = $adminPassword
$adminDocument = node .\scripts\create-first-admin-document.js
Remove-Item Env:ADMIN_USERNAME, Env:ADMIN_EMAIL, Env:ADMIN_PASSWORD -ErrorAction SilentlyContinue
$adminDocument
$adminDocumentText = $adminDocument -join [Environment]::NewLine
Set-Clipboard -Value $adminDocumentText
```

Required: one JSON document is printed. It contains `passwordHash` beginning with `$2`, `role` equal to `admin`, `isEmailVerified` and `isActive` equal to `true`, and `tokenVersion` equal to `0`. It contains no `password` field. Treat this output as secret because its hash and email identify a usable account.

Insert it in MongoDB Compass:

1. Connect Compass to `mongodb://127.0.0.1:27017`.
2. Open database `vehicle_service_booking`, then collection `users`.
3. If `users` is not visible, confirm `npm start` is running, refresh Compass, and look again.
4. Select **Add Data → Insert Document**.
5. Delete the sample object, paste the complete JSON from the local clipboard, and select **Insert**.
6. Confirm the saved fields match the required values above. Never paste the normal password into Compass.
7. Clear the generated output from PowerShell after insertion:

```powershell
$adminDocument = $null
$adminDocumentText = $null
Set-Clipboard -Value ""
```

Log in as the first administrator:

```powershell
$adminLoginBody = @{ identifier = $adminEmail; password = $adminPassword } | ConvertTo-Json
$adminSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$adminLogin = Invoke-RestMethod -Method Post -Uri http://localhost:5000/api/auth/login -ContentType "application/json" -Headers @{ Origin = "http://localhost:5173" } -Body $adminLoginBody -WebSession $adminSession
$adminLogin.user | Select-Object username, email, role, isEmailVerified, isActive
$adminPassword = $null
$secureAdminPassword = $null
$adminLoginBody = $null
```

Required: login succeeds and shows `role` as `admin`.

Create an invitation for a different email address. The invited person must be able to open that inbox later for account verification:

```powershell
$inviteEmail = Read-Host "New administrator email"
$inviteBody = @{ email = $inviteEmail } | ConvertTo-Json
$inviteResponse = Invoke-WebRequest -UseBasicParsing -Method Post -Uri http://localhost:5000/api/admin/invitations -ContentType "application/json" -Headers @{ Origin = "http://localhost:5173" } -Body $inviteBody -WebSession $adminSession
$invite = $inviteResponse.Content | ConvertFrom-Json
$inviteResponse.StatusCode
$invite | Select-Object message, invitedEmail, expiresAt
if ($invite.PSObject.Properties.Name -contains "token") { throw "FAIL: API exposed a raw invitation token" }
if (-not ($invite.PSObject.Properties.Name -contains "invitationLink")) { throw "FAIL: API omitted the copyable invitation link" }
$allowedInviteFields = @("expiresAt", "invitedEmail", "invitationLink", "message")
$actualInviteFields = @($invite.PSObject.Properties.Name | Sort-Object)
if (($actualInviteFields -join ",") -ne ($allowedInviteFields -join ",")) { throw "FAIL: invitation API returned an unexpected field" }
$inviteLink = [string]$invite.invitationLink
if ($inviteLink -notmatch '^http://localhost:5173/admin/accept-invitation\?token=([a-f0-9]{64})&email=') { throw "FAIL: invitation link has an unexpected format" }
$inviteToken = $Matches[1]
Set-Clipboard -Value $inviteLink
```

Required: status `201`, message `Administrator invitation created`, the correct invited email, an expiry about 24 hours in the future, and one `invitationLink`. Creation sends no administrator-invitation email. The response has no separate `token` field, and the database stores only the link token's SHA-256 hash. Share the clipboard link securely with the invited person; anyone holding it can attempt acceptance until it expires or is used.

Use the exact email bound into the copied link. Choose the invited username and password with the same rules from section 3. First prove that the invitation is email-bound, then accept it:

```powershell
$invitedUsername = Read-Host "New administrator username"
$secureInvitedPassword = Read-Host "New administrator password" -AsSecureString
$invitedPassword = [System.Net.NetworkCredential]::new("", $secureInvitedPassword).Password
$wrongAcceptBody = @{ token = $inviteToken; email = "wrong@example.com"; username = $invitedUsername; password = $invitedPassword } | ConvertTo-Json
try {
  Invoke-RestMethod -Method Post -Uri http://localhost:5000/api/auth/admin-invitations/accept -ContentType "application/json" -Headers @{ Origin = "http://localhost:5173" } -Body $wrongAcceptBody
  throw "FAIL: invitation accepted the wrong email"
} catch {
  if ([int]$_.Exception.Response.StatusCode -ne 400) { throw }
  "PASS: wrong invited email returned 400"
}
$acceptBody = @{ token = $inviteToken; email = $inviteEmail; username = $invitedUsername; password = $invitedPassword } | ConvertTo-Json
$acceptedResponse = Invoke-WebRequest -UseBasicParsing -Method Post -Uri http://localhost:5000/api/auth/admin-invitations/accept -ContentType "application/json" -Headers @{ Origin = "http://localhost:5173" } -Body $acceptBody
$accepted = $acceptedResponse.Content | ConvertFrom-Json
$acceptedResponse.StatusCode
$accepted.user | Select-Object username, email, role, isEmailVerified, isActive
```

Required: wrong email returns `400`; exact email returns `201`. The created account has `role: admin`, `isEmailVerified: False`, and `isActive: True`. Gmail receives a separate message with subject `Verify your Vehicle Service Booking email`.

Before verifying the invited administrator, confirm login returns `403`:

```powershell
$invitedLoginBody = @{ identifier = $inviteEmail; password = $invitedPassword } | ConvertTo-Json
try {
  Invoke-RestMethod -Method Post -Uri http://localhost:5000/api/auth/login -ContentType "application/json" -Headers @{ Origin = "http://localhost:5173" } -Body $invitedLoginBody
  throw "FAIL: unverified invited administrator logged in"
} catch {
  if ([int]$_.Exception.Response.StatusCode -ne 403) { throw }
  "PASS: unverified invited administrator returned 403"
}
```

Copy the token from the separate verification email, verify it, and prove both tokens are single-use:

```powershell
$secureInvitedVerificationToken = Read-Host "Invited administrator verification token" -AsSecureString
$invitedVerificationToken = [System.Net.NetworkCredential]::new("", $secureInvitedVerificationToken).Password
$invitedVerifyBody = @{ token = $invitedVerificationToken } | ConvertTo-Json
$invitedVerified = Invoke-RestMethod -Method Post -Uri http://localhost:5000/api/auth/verify-email -ContentType "application/json" -Headers @{ Origin = "http://localhost:5173" } -Body $invitedVerifyBody
$invitedVerified.message
try {
  Invoke-RestMethod -Method Post -Uri http://localhost:5000/api/auth/admin-invitations/accept -ContentType "application/json" -Headers @{ Origin = "http://localhost:5173" } -Body $acceptBody
  throw "FAIL: invitation was accepted twice"
} catch {
  if ([int]$_.Exception.Response.StatusCode -ne 400) { throw }
  "PASS: second invitation acceptance returned 400"
}
try {
  Invoke-RestMethod -Method Post -Uri http://localhost:5000/api/auth/verify-email -ContentType "application/json" -Headers @{ Origin = "http://localhost:5173" } -Body $invitedVerifyBody
  throw "FAIL: invited verification token was accepted twice"
} catch {
  if ([int]$_.Exception.Response.StatusCode -ne 400) { throw }
  "PASS: second invited verification use returned 400"
}
$invitedSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$invitedLogin = Invoke-RestMethod -Method Post -Uri http://localhost:5000/api/auth/login -ContentType "application/json" -Headers @{ Origin = "http://localhost:5173" } -Body $invitedLoginBody -WebSession $invitedSession
$invitedLogin.user | Select-Object username, email, role, isEmailVerified, isActive
$inviteToken = $null
$inviteLink = $null
Set-Clipboard -Value ""
$invitedVerificationToken = $null
$secureInvitedVerificationToken = $null
$invitedPassword = $null
$secureInvitedPassword = $null
$acceptBody = $null
$wrongAcceptBody = $null
$invitedVerifyBody = $null
$invitedLoginBody = $null
```

Required: verification succeeds once, both reuse attempts return `400`, and the final login shows a verified, active administrator.

## 6. Compass hash and token inspection

In Compass, open `vehicle_service_booking` and inspect `users`, `authtokens`, and `admininvitations`. A collection may be empty after a token is consumed or TTL cleanup runs; that is acceptable.

Required:

- Every `users.passwordHash` is bcrypt text beginning with `$2`; it never equals or contains a normal password.
- `users` documents may contain `tokenVersion`, but API responses never do.
- `authtokens` contains only `tokenHash`, never a usable verification or reset token. A hash is 64 hexadecimal characters and must not equal the token received by Gmail.
- `admininvitations` contains only `tokenHash`, never a usable invitation token or full invitation link. The accepted invitation has a non-null `usedAt` if TTL cleanup has not removed it.
- The single-use API checks in sections 3 and 5 fail even if a used document is still visible before TTL cleanup.
- No API response contains `passwordHash`, `tokenHash`, `tokenVersion`, Gmail credentials, `JWT_SECRET`, or a separate raw `token` field. The invitation-creation response intentionally contains the copyable raw link once; no other response contains it.

Use this local PowerShell check on the response objects still in memory. It prints nothing when the API responses are safe:

```powershell
@($registration, $login, $me, $invite, $accepted, $invitedLogin) |
  ConvertTo-Json -Depth 10 |
  Select-String -Pattern '"(?:passwordHash|tokenHash|tokenVersion|GMAIL_APP_PASSWORD|JWT_SECRET|token)"\s*:'
```

Required output: nothing.

Finally, record only six `PASS` or `FAIL` results, clear the remaining local values, and confirm secrets are not staged:

```powershell
$customerSession = $null
$adminSession = $null
$invitedSession = $null
$registration = $null
$login = $null
$me = $null
$invite = $null
$accepted = $null
$invitedLogin = $null
$blockedLoginBody = $null
git status --short
```

Required: `.env`, `node_modules`, generated administrator JSON, passwords, cookies, and tokens do not appear. Do not call authentication complete from screenshots alone; the terminal, API, Gmail, and Compass results above must agree.
