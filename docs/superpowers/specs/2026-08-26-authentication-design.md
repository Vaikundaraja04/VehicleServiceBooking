# Vehicle Service Booking Authentication Design

Date: 2026-08-26  
Status: Approved  
Scope: Backend authentication and authorization subsystem

## 1. Purpose

Build a secure, beginner-readable authentication subsystem for the Vehicle Service Booking MERN application. It supports customers and administrators while keeping passwords, tokens, Gmail credentials, and JWT secrets out of client storage and source control.

This subsystem is intentionally separated from vehicle management, service bookings, reports, and the React user interface. Those features will consume the authentication API later.

## 2. Approved Decisions

- Use a layered REST API architecture.
- Allow login with either email or username plus password.
- Give every user exactly one role: `customer` or `admin`.
- Let customers register publicly, but block login until email verification succeeds.
- Send real development emails through Gmail using `Nodemailer`.
- Store the login JWT only in an `HttpOnly` cookie.
- Include logout, current-user lookup, forgot password, reset password, and authenticated change password.
- Create the first administrator manually in MongoDB Compass using a previously generated password hash.
- Let an existing administrator create a single-use administrator invitation link and share it manually.
- Require an invited administrator to verify the invited email address before login.
- Keep the first version stateless: one eight-hour JWT and no refresh-token subsystem.

## 3. Architecture

### 3.1 Request flow

```text
React frontend
      |
      v
Express route
      |
      v
Authentication / role / validation middleware
      |
      v
Controller
      |
      v
Service or Mongoose model
      |
      v
MongoDB or Gmail
```

Errors from every layer pass to one central error-handling middleware.

### 3.2 Backend responsibilities

```text
server/
|-- config/          MongoDB and email configuration
|-- models/          User, authentication-token, and invitation schemas
|-- routes/          API endpoint definitions
|-- controllers/     HTTP request and response handling
|-- middleware/      Authentication, authorization, validation, and errors
|-- services/        Email, token, and authentication operations
|-- utils/           Cookie and response helpers
`-- tests/           Unit and API integration tests
```

Existing files retain their current roles:

- `app.js` creates the Express application and registers middleware and routes.
- `index.js` connects to MongoDB and starts the HTTP server.
- `config/db.js` contains only MongoDB connection logic.

Each unit has one clear purpose. Vehicle and booking modules can later follow the same boundaries without changing the authentication internals.

## 4. Data Model

### 4.1 User

The `User` collection contains:

| Field | Rule and purpose |
|---|---|
| `username` | Required, trimmed, lowercased, unique, 3-30 characters |
| `email` | Required, lowercase, normalized, unique |
| `mobile` | Required for customer registration, exactly 10 digits |
| `address` | Required for customers, optional for administrators, maximum 500 characters |
| `passwordHash` | Required bcrypt hash; excluded from normal query results |
| `role` | Enum: `customer` or `admin`; public registration always forces `customer` |
| `isEmailVerified` | Boolean; false until verification succeeds |
| `isActive` | Boolean; administrators can use it to disable access |
| `tokenVersion` | Integer starting at 0; incremented after password change or reset |
| `createdAt` | Automatic creation timestamp |
| `updatedAt` | Automatic update timestamp |

MongoDB unique indexes enforce uniqueness for normalized `username` and `email`. Application validation provides readable conflict messages, while duplicate-key handling protects against concurrent requests.

### 4.2 AuthToken

The `AuthToken` collection supports `email_verification` and `password_reset` records:

| Field | Rule and purpose |
|---|---|
| `userId` | Reference to `User` |
| `type` | Enum: `email_verification` or `password_reset` |
| `tokenHash` | Unique SHA-256 hash of the random token; the usable token is never stored |
| `expiresAt` | Expiration timestamp with a MongoDB TTL index |
| `createdAt` | Automatic creation timestamp |

Only one active token of a given type is kept for a user. Issuing another token invalidates the previous one. Successful use atomically consumes the record so parallel requests cannot reuse it.

### 4.3 AdminInvitation

The `AdminInvitation` collection contains:

| Field | Rule and purpose |
|---|---|
| `invitedEmail` | Required lowercase email bound to the invitation |
| `tokenHash` | Unique hash of the single-use random invitation token |
| `invitedBy` | Reference to the administrator who created it |
| `expiresAt` | Twenty-four-hour expiration with TTL cleanup |
| `usedAt` | Set when the invitation is consumed |
| `createdAt` | Automatic creation timestamp |

Creating a new invitation for the same email invalidates any unused older invitation. Acceptance requires the submitted email to match `invitedEmail`. The accepted account receives role `admin`, starts with `isEmailVerified: false`, and receives a normal Gmail verification link before login is allowed.

### 4.4 First administrator

The first administrator is a deliberate bootstrap exception. A safe terminal command will generate the password hash. The user will insert a document through Compass with role `admin`, `isEmailVerified: true`, `isActive: true`, and `tokenVersion: 0`. A normal password must never be pasted into MongoDB.

## 5. API Contract

All endpoints use JSON unless they only clear a cookie. Successful responses never include `passwordHash`, token hashes, `tokenVersion`, Gmail credentials, or `JWT_SECRET`.

### 5.1 Public authentication endpoints

| Method | Path | Responsibility |
|---|---|---|
| `POST` | `/api/auth/register` | Create an unverified customer and send verification email |
| `POST` | `/api/auth/verify-email` | Consume a valid verification token |
| `POST` | `/api/auth/resend-verification` | Replace the existing verification token and resend email |
| `POST` | `/api/auth/login` | Accept `identifier` as email or username and set the login cookie |
| `POST` | `/api/auth/logout` | Clear the login cookie |
| `POST` | `/api/auth/forgot-password` | Issue a neutral response and send reset email when applicable |
| `POST` | `/api/auth/reset-password` | Consume reset token, replace password, and invalidate old JWTs |
| `POST` | `/api/auth/admin-invitations/accept` | Create an unverified admin from a valid invitation |

### 5.2 Protected user endpoints

| Method | Path | Responsibility |
|---|---|---|
| `GET` | `/api/auth/me` | Return the safe current-user profile |
| `PATCH` | `/api/auth/change-password` | Verify current password, replace it, and invalidate old JWTs |

### 5.3 Administrator endpoint

| Method | Path | Responsibility |
|---|---|---|
| `POST` | `/api/admin/invitations` | Create a 24-hour single-use invitation for an email |

This endpoint requires a valid cookie, an active and verified user, and role `admin`.

## 6. Main Flows

### 6.1 Customer registration and verification

1. Validate and normalize the submitted fields.
2. Reject any client-supplied `role` field and assign role `customer` on the server.
3. Hash the password before saving the user.
4. Save the account with `isEmailVerified: false` and `isActive: true`.
5. Create a one-hour verification token and store only its hash.
6. Send the usable link through Gmail.
7. If Gmail fails after user creation, retain the unverified account and return `201` with `emailSent: false` and a safe message directing the customer to resend verification. Never return the token.
8. Verification atomically consumes the token and marks the user verified.
9. Only then may the customer log in.

`resend-verification` returns the same neutral response for unknown, already verified, and eligible addresses. When eligible, it replaces the old token before attempting delivery.

### 6.2 Login and current session

1. Normalize `identifier` and look up the user by exact email or username.
2. Compare the submitted password with `passwordHash`.
3. Reject incorrect credentials with one generic message.
4. Reject an inactive or unverified account with a safe, specific status.
5. Sign a JWT containing only user ID and `tokenVersion`; authorization always uses the current database role.
6. Store the JWT in an eight-hour `HttpOnly` cookie; do not return it in JSON.
7. On each protected request, verify the JWT, load the current user, and check its current role, active state, verification state, and `tokenVersion`.

The cookie uses `HttpOnly`, `SameSite=Lax`, an eight-hour `Max-Age`, and `Secure` in HTTPS environments. CORS permits credentials only from the exact configured React origin. Unsafe requests with a different `Origin` are rejected.

### 6.3 Logout

Logout clears the authentication cookie using the same cookie attributes. Because the system is stateless, no server session document is required.

### 6.4 Forgot and reset password

1. `forgot-password` always returns the same neutral response whether the email exists or not.
2. For an eligible account, replace any previous reset token and email a new 15-minute link.
3. `reset-password` atomically consumes the token, hashes the new password, increments `tokenVersion`, and removes other reset tokens.
4. Previously issued JWT cookies fail on their next protected request because their version no longer matches.

### 6.5 Change password

An authenticated user supplies the current and new passwords. The server verifies the current password, saves the new hash, increments `tokenVersion`, and clears the current cookie. The user must log in again.

### 6.6 Administrator invitation

1. A verified, active administrator submits an email.
2. The system refuses invitations for an existing account and replaces any unused invitation for that email.
3. The system stores a token hash and returns the usable invitation link once.
4. The administrator copies and shares the link manually.
5. Acceptance checks the hash, email binding, expiration, and unused state atomically.
6. The new account receives role `admin` but remains unverified.
7. Gmail sends a separate one-hour email-verification link.
8. If Gmail delivery fails, the account remains unverified and can use the normal resend-verification flow.

## 7. Validation

- `username`: 3-30 characters using letters, numbers, and underscore only.
- `email`: valid syntax, trimmed, and lowercased.
- `password`: 8-72 characters containing at least one uppercase letter, one lowercase letter, and one number.
- `mobile`: exactly 10 ASCII digits.
- `address`: trimmed, non-empty for customers, and no more than 500 characters.
- Unknown fields are rejected rather than silently persisted.
- All token inputs must be correctly shaped before hashing or database lookup.

The implementation will use one reusable validation layer so controllers do not repeat field rules.

## 8. Security Controls

- Hash passwords with bcrypt using cost factor 12. If local test timing proves this unusable on the development computer, changing the cost requires an explicit design amendment.
- Generate verification, reset, and invitation tokens with a cryptographically secure random generator.
- Hash all database tokens with SHA-256 before persistence.
- Store Gmail address, Gmail App Password, `JWT_SECRET`, `MONGO_URI`, `CLIENT_URL`, and environment mode only in `.env`.
- Keep `.env` and `node_modules/` ignored by Git.
- Apply security headers, strict JSON body-size limits, exact-origin CORS, credential support, and origin checks.
- Rate-limit login, forgot-password, verification resend, registration, and invitation creation separately.
- Never log passwords, cookies, usable tokens, Gmail credentials, or full reset and verification URLs.
- Use generic login and forgot-password messages to reduce account enumeration.
- Query the current user on every protected request so deactivation and role changes take effect immediately.
- Clear cookies and increment `tokenVersion` after password replacement.

Recommended initial rate limits are five login attempts per IP per 15 minutes and three resend or recovery requests per account/IP per 15 minutes. Tests will verify limits without depending on real time delays.

## 9. Error Contract

The central error middleware returns a consistent JSON shape:

```json
{
  "message": "Human-readable summary",
  "errors": [
    { "field": "email", "message": "Field-specific explanation" }
  ]
}
```

The `errors` array is optional. Production responses never include internal stack traces.

| Status | Meaning |
|---|---|
| `400` | Invalid input or malformed token |
| `401` | Missing login or incorrect credentials |
| `403` | Unverified email, inactive account, or insufficient role |
| `404` | Resource not found when disclosure is safe |
| `409` | Email or username conflict |
| `429` | Rate limit exceeded |
| `500` | Safe generic server failure |
| `502` | Development email provider failed during an explicit resend operation |

Token errors use safe messages such as "This link is invalid or expired" and do not distinguish between unknown, used, and expired token hashes.

## 10. Testing Strategy

Use Node's built-in test runner and `supertest`. API integration tests use a separate MongoDB database. The email service is injected or mocked so automated tests never contact Gmail.

Test coverage includes:

- User validation and password hashing.
- Registration success and unknown-field rejection.
- Duplicate email and username conflicts, including database duplicate-key errors.
- Verification issuance, replacement, success, expiration, and reuse rejection.
- Login by email and by username.
- Incorrect credentials, unverified users, inactive users, and malformed cookies.
- Safe cookie attributes, current-user response, and logout clearing.
- Forgot-password neutrality.
- Reset and change-password success, expiration, reuse rejection, and `tokenVersion` invalidation.
- Customer rejection from administrator routes.
- Administrator invitation creation, email binding, expiration, single use, and existing-user conflict.
- Central error shape and production stack-trace suppression.
- Rate limits with isolated limiter state.
- MongoDB and startup-failure behavior.

The existing health, database, and startup tests remain part of the suite. A separate manual check will confirm one Gmail verification email after environment setup.

## 11. Configuration

The server will require these environment values:

- `PORT`
- `MONGO_URI`
- `CLIENT_URL`
- `JWT_SECRET`
- `JWT_EXPIRES_IN`
- `GMAIL_USER`
- `GMAIL_APP_PASSWORD`
- `NODE_ENV`

For local development, `CLIENT_URL` is `http://localhost:5173`, `JWT_EXPIRES_IN` is `8h`, and `NODE_ENV` is `development`. An `.env.example` will contain variable names and safe sample values, never real secrets.

## 12. Acceptance Criteria

The authentication subsystem is complete when:

1. A customer can register but cannot log in before email verification.
2. A valid one-hour link verifies the customer exactly once.
3. A verified active customer can log in with email or username.
4. Login sets an eight-hour `HttpOnly` cookie and never exposes the JWT to JavaScript.
5. Protected routes reject missing, expired, stale, inactive, unverified, and unauthorized identities.
6. Logout clears the cookie.
7. Forgot-password responses do not reveal whether an account exists.
8. Valid 15-minute reset links work once and invalidate existing JWTs.
9. Authenticated users can change their password and must log in again.
10. Only administrators can create administrator invitations.
11. A valid 24-hour invitation creates an unverified administrator exactly once and binds it to the invited email.
12. The first manually inserted administrator uses a password hash, never a normal password.
13. Automated tests pass without contacting Gmail or using the development database.
14. `npm audit` reports no known vulnerabilities after the required packages are installed.

## 13. Out of Scope

- React authentication screens and routing.
- Vehicle, booking, service-history, and report APIs.
- Social login or OAuth providers.
- Multi-factor authentication.
- Refresh tokens and multi-device session management.
- Production transactional-email provider and custom-domain DNS setup.
- Deployment configuration.

These may be designed as separate subsystems after the backend authentication API is verified.
