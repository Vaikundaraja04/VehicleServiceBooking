# Vehicle Service Booking Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify the complete backend authentication and authorization subsystem for customers and administrators.

**Architecture:** Keep `app.js` responsible for Express composition and `index.js` responsible for startup. Routes call controllers, controllers call focused services, Mongoose models own persistence rules, and reusable middleware handles validation, cookies, authentication, authorization, rate limits, origins, and errors. Automated tests use a separate local MongoDB database and an injected email transport, so they never contact Gmail or alter development data.

**Tech Stack:** Node.js 24, CommonJS, Express, MongoDB, Mongoose, Node test runner, Supertest, bcryptjs, jsonwebtoken, Nodemailer, express-validator, cookie-parser, CORS, Helmet, and express-rate-limit.

**Spec:** `docs/superpowers/specs/2026-08-26-authentication-design.md`

## Global Constraints

- Work from `C:\Users\Durai\VehicleServiceBooking\server` in PowerShell; verify the prompt ends in `\server>` before every `npm` command.
- Keep the current health, database-connection, and startup-failure tests passing.
- Use CommonJS `require()` and `module.exports` because `package.json` has `"type": "commonjs"`.
- Use the local development database `mongodb://127.0.0.1:27017/vehicle_service_booking` and the isolated test database `mongodb://127.0.0.1:27017/vehicle_service_booking_test`.
- Never run tests against `vehicle_service_booking`; test cleanup is allowed only for `vehicle_service_booking_test`.
- Public registration always creates role `customer`; a request containing `role` is rejected.
- Passwords are 8-72 characters with at least one uppercase letter, one lowercase letter, and one number; bcrypt cost is exactly 12.
- Raw verification, reset, and invitation tokens are 32 random bytes represented as 64 lowercase hexadecimal characters; MongoDB stores only SHA-256 hashes.
- Email-verification tokens last 60 minutes, password-reset tokens 15 minutes, administrator invitations 24 hours, and login JWTs 8 hours.
- The login cookie is named `vsb_auth` and uses `HttpOnly`, `SameSite=Lax`, `Path=/`, an eight-hour `Max-Age`, and `Secure` only when `NODE_ENV=production`.
- JWT payloads contain only `sub` (user ID) and `ver` (`tokenVersion`); every protected request reloads current role, activity, verification, and token version from MongoDB.
- Gmail credentials, `JWT_SECRET`, `MONGO_URI`, and usable tokens never appear in source control, API JSON, or logs.
- JSON bodies are limited to 20 KB, credentialed CORS accepts only `CLIENT_URL`, and unsafe cross-origin requests are rejected.
- Initial limits are five login attempts per IP per 15 minutes and three registration, resend, recovery, or invitation attempts per account/IP per 15 minutes.
- Error JSON is `{ "message": string, "errors"?: [{ "field": string, "message": string }] }`; production JSON never includes a stack trace.
- Use `node --test` and Supertest. Email tests inject a fake transporter and must not contact Gmail.
- Use test-driven development for every behavior: observe the expected failure before adding implementation code.
- After every task, run the focused test and the entire suite. Commit commands assume Git is installed; if Git reports that author identity is missing, stop and configure the real name and email rather than inventing them.

---
## File Map

### Existing files modified

- `server/package.json` — dependency and start/test commands.
- `server/package-lock.json` — npm's exact dependency lock.
- `server/.env` — local secrets and machine-specific settings; never committed.
- `server/.gitignore` — protects `.env`, dependencies, and test artifacts.
- `server/app.js` — creates Express, applies global middleware, mounts routes, and exports the app.
- `server/index.js` — loads environment settings, connects to MongoDB, and listens only after connection succeeds.
- `server/config/db.js` — connects Mongoose to the URI supplied by startup or tests.

### Configuration and shared infrastructure created

- `server/.env.example` — safe configuration template without real secrets.
- `server/config/env.js` — validates and normalizes environment values.
- `server/config/email.js` — creates the Gmail Nodemailer transport.
- `server/utils/AppError.js` — expected HTTP error type.
- `server/utils/asyncHandler.js` — forwards rejected controller promises.
- `server/utils/userResponse.js` — creates the public user JSON shape.
- `server/utils/authCookie.js` — sets and clears the JWT cookie consistently.
- `server/middleware/errorHandler.js` — translates all errors to the shared JSON contract.
- `server/middleware/notFound.js` — produces a JSON 404.
- `server/middleware/originGuard.js` — rejects unsafe requests from the wrong origin.
- `server/middleware/validateRequest.js` — rejects unknown fields and formats validation failures.
- `server/middleware/authenticate.js` — verifies JWT and reloads the current user.
- `server/middleware/authorize.js` — checks the current database role.
- `server/middleware/rateLimiters.js` — creates isolated endpoint-specific limiters.

### Authentication domain files created

- `server/models/User.js` — user persistence rules and safe serialization.
- `server/models/AuthToken.js` — hashed email-verification and reset tokens.
- `server/models/AdminInvitation.js` — hashed, bound, single-use administrator invitations.
- `server/services/passwordService.js` — bcrypt hashing and comparison.
- `server/services/tokenService.js` — random-token generation, hashing, issuance, replacement, and consumption.
- `server/services/emailService.js` — verification/reset email composition and injectable delivery.
- `server/services/jwtService.js` — signs and verifies the minimal JWT payload.
- `server/services/authService.js` — registration, verification, login, password, and invitation business rules.
- `server/validators/authValidators.js` — reusable request field validation and normalization.
- `server/controllers/authController.js` — public/protected authentication HTTP handlers.
- `server/controllers/adminController.js` — administrator invitation HTTP handler.
- `server/routes/authRoutes.js` — `/api/auth` route definitions.
- `server/routes/adminRoutes.js` — `/api/admin` route definitions.
- `server/scripts/create-first-admin-document.js` — safely generates a complete Compass document containing a bcrypt hash.

### Tests and teaching documentation created

- `server/tests/test-env.js` — forces test-safe environment values before test discovery.
- `server/tests/helpers/testDb.js` — connects to, clears, and disconnects only the test database.
- `server/tests/config/env.test.js` — environment contract tests.
- `server/tests/models/user.test.js` — user and password tests.
- `server/tests/security/app-security.test.js` — headers, origin, body limit, errors, and rate-limit tests.
- `server/tests/services/token.test.js` — hashed token lifecycle tests.
- `server/tests/services/email.test.js` — link and injected email tests.
- `server/tests/auth/register.test.js` — customer-registration tests.
- `server/tests/auth/verification.test.js` — verify/resend tests.
- `server/tests/auth/session.test.js` — login, cookie, current-user, logout, and authorization tests.
- `server/tests/auth/password-reset.test.js` — forgot/reset and stale-JWT tests.
- `server/tests/auth/change-password.test.js` — authenticated password-change tests.
- `server/tests/auth/admin-invitation.test.js` — invitation creation and acceptance tests.
- `server/tests/scripts/create-first-admin-document.test.js` — bootstrap-document safety test.
- `server/tests/auth/authentication-acceptance.test.js` — complete customer flow without Gmail.
- `server/docs/authentication-manual-checks.md` — Gmail, Compass, and browser verification checklist.

---

### Task 1: Test-Safe Configuration and Dependency Baseline

**Files:**
- Create: `server/tests/config/env.test.js`
- Create: `server/tests/test-env.js`
- Create: `server/config/env.js`
- Create: `server/.env.example`
- Modify: `server/.gitignore`
- Modify: `server/config/db.js`
- Modify: `server/index.js`
- Modify: `server/package.json`
- Modify: `server/package-lock.json`

**Interfaces:**
- Consumes: existing `connectDB()` export from `config/db.js`, existing `app` export from `app.js`, and existing npm tests.
- Produces: `readConfig(source)` returning normalized configuration; `connectDB(uri)` returning Mongoose's connection promise; a preloaded isolated test environment.

- [ ] **Step 1: Confirm the working directory and initialize Git if needed**

Run:

```powershell
Set-Location "C:\Users\Durai\VehicleServiceBooking\server"
Get-Location
git status
```

Expected path: `C:\Users\Durai\VehicleServiceBooking\server`.

If `git status` says this is not a repository, run:

```powershell
git init
```

- [ ] **Step 2: Write the failing environment-contract test**

Create `tests/config/env.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");

const { readConfig } = require("../../config/env");

const validSource = {
  PORT: "5000",
  MONGO_URI: "mongodb://127.0.0.1:27017/vehicle_service_booking",
  CLIENT_URL: "http://localhost:5173",
  JWT_SECRET: "test-secret-with-more-than-32-characters",
  JWT_EXPIRES_IN: "8h",
  GMAIL_USER: "test@example.com",
  GMAIL_APP_PASSWORD: "test-app-password",
  NODE_ENV: "test",
};

test("readConfig returns normalized settings", () => {
  const result = readConfig(validSource);

  assert.equal(result.port, 5000);
  assert.equal(result.mongoUri, validSource.MONGO_URI);
  assert.equal(result.clientUrl, validSource.CLIENT_URL);
  assert.equal(result.jwtExpiresIn, "8h");
  assert.equal(result.nodeEnv, "test");
  assert.equal(result.isProduction, false);
});

test("readConfig rejects missing values and a short JWT secret", () => {
  assert.throws(() => readConfig({}), /Missing environment variables/);
  assert.throws(
    () => readConfig({ ...validSource, JWT_SECRET: "short" }),
    /JWT_SECRET must contain at least 32 characters/,
  );
  assert.throws(
    () => readConfig({ ...validSource, JWT_EXPIRES_IN: "1d" }),
    /JWT_EXPIRES_IN must be 8h/,
  );
});
```

- [ ] **Step 3: Run the focused test and verify the expected failure**

Run:

```powershell
node --test .\tests\config\env.test.js
```

Expected: FAIL with `Cannot find module '../../config/env'`.

- [ ] **Step 4: Install the required authentication packages**

Run:

```powershell
npm install bcryptjs cookie-parser cors express-rate-limit express-validator helmet jsonwebtoken nodemailer
npm audit
```

Expected: installation succeeds and `npm audit` reports `found 0 vulnerabilities`. Do not run `npm audit fix --force`.

- [ ] **Step 5: Create the configuration module and test preloader**

Create `config/env.js`:

```js
const REQUIRED_NAMES = [
  "PORT",
  "MONGO_URI",
  "CLIENT_URL",
  "JWT_SECRET",
  "JWT_EXPIRES_IN",
  "NODE_ENV",
];

function readConfig(source = process.env) {
  const missing = REQUIRED_NAMES.filter((name) => !String(source[name] || "").trim());

  if (missing.length > 0) {
    throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  }

  const port = Number(source.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer from 1 to 65535");
  }

  if (String(source.JWT_SECRET).length < 32) {
    throw new Error("JWT_SECRET must contain at least 32 characters");
  }

  if (source.JWT_EXPIRES_IN !== "8h") {
    throw new Error("JWT_EXPIRES_IN must be 8h");
  }

  if (!new Set(["development", "test", "production"]).has(source.NODE_ENV)) {
    throw new Error("NODE_ENV must be development, test, or production");
  }

  return Object.freeze({
    port,
    mongoUri: source.MONGO_URI,
    clientUrl: source.CLIENT_URL,
    jwtSecret: source.JWT_SECRET,
    jwtExpiresIn: source.JWT_EXPIRES_IN,
    nodeEnv: source.NODE_ENV,
    isProduction: source.NODE_ENV === "production",
  });
}

module.exports = { readConfig };
```

Create `tests/test-env.js`:

```js
process.env.NODE_ENV = "test";
process.env.PORT = "5001";
process.env.MONGO_URI_TEST =
  process.env.MONGO_URI_TEST ||
  "mongodb://127.0.0.1:27017/vehicle_service_booking_test";
process.env.MONGO_URI = process.env.MONGO_URI_TEST;
process.env.CLIENT_URL = "http://localhost:5173";
process.env.JWT_SECRET = "test-only-secret-with-more-than-32-characters";
process.env.JWT_EXPIRES_IN = "8h";
process.env.GMAIL_USER = "test@example.com";
process.env.GMAIL_APP_PASSWORD = "test-app-password";
```

- [ ] **Step 6: Add the safe environment template and local values**

Create `.env.example`:

```dotenv
PORT=5000
MONGO_URI=mongodb://127.0.0.1:27017/vehicle_service_booking
MONGO_URI_TEST=mongodb://127.0.0.1:27017/vehicle_service_booking_test
CLIENT_URL=http://localhost:5173
JWT_SECRET=development-only-change-this-to-at-least-32-random-characters
JWT_EXPIRES_IN=8h
GMAIL_USER=your-address@gmail.com
GMAIL_APP_PASSWORD=your-16-character-app-password
NODE_ENV=development
```

Ensure `.gitignore` contains exactly these protections:

```gitignore
node_modules/
.env
coverage/
```

Keep the current `PORT` and `MONGO_URI` in `.env`, then add these non-secret values:

```dotenv
CLIENT_URL=http://localhost:5173
JWT_EXPIRES_IN=8h
NODE_ENV=development
```

Generate a private JWT secret locally:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

Copy the one generated line into `.env` after `JWT_SECRET=`. Do not reuse the safe sample from `.env.example`, paste the generated value into chat, or commit it.

Do not add Gmail values to `.env` until Task 5. Do not paste `.env` into chat after it contains real credentials.

- [ ] **Step 7: Make database connection and startup consume validated configuration**

Replace `config/db.js` with:

```js
const mongoose = require("mongoose");

async function connectDB(uri = process.env.MONGO_URI) {
  return mongoose.connect(uri);
}

module.exports = connectDB;
```

Replace `index.js` with:

```js
require("dotenv").config({ quiet: true });

const app = require("./app");
const connectDB = require("./config/db");
const { readConfig } = require("./config/env");

async function startServer() {
  try {
    const config = readConfig();
    await connectDB(config.mongoUri);

    app.listen(config.port, () => {
      console.log(`Server is running on http://localhost:${config.port}`);
    });
  } catch (error) {
    console.error(`Server startup failed: ${error.message}`);
    process.exitCode = 1;
  }
}

startServer();
```

Set the test command:

```powershell
npm pkg set scripts.test="node --require ./tests/test-env.js --test --test-concurrency=1"
npm pkg get scripts.test
```

Expected value: `"node --require ./tests/test-env.js --test --test-concurrency=1"`.

- [ ] **Step 8: Run focused and complete verification**

Run:

```powershell
npm test -- .\tests\config\env.test.js
npm test
npm audit
```

Expected: environment tests pass, the three existing tests still pass, and audit reports zero vulnerabilities.

- [ ] **Step 9: Commit the configuration baseline**

```powershell
git add package.json package-lock.json .gitignore .env.example config/env.js config/db.js index.js tests/test-env.js tests/config/env.test.js
git commit -m "chore: add test-safe authentication configuration"
```

Never add `.env` to the commit.

---

### Task 2: User Model and Password Protection

**Files:**
- Create: `server/models/User.js`
- Create: `server/services/passwordService.js`
- Create: `server/utils/userResponse.js`
- Create: `server/tests/helpers/testDb.js`
- Create: `server/tests/models/user.test.js`

**Interfaces:**
- Consumes: `process.env.MONGO_URI_TEST` from Task 1.
- Produces: `User`; `hashPassword(password)`; `comparePassword(password, hash)`; `toSafeUser(user)`; `connectTestDb()`, `clearTestDb()`, and `disconnectTestDb()`.

- [ ] **Step 1: Write the failing user and password tests**

Create `tests/helpers/testDb.js`:

```js
const mongoose = require("mongoose");

async function connectTestDb() {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI_TEST);
  }
}

async function clearTestDb() {
  const databaseName = mongoose.connection.name;
  if (databaseName !== "vehicle_service_booking_test") {
    throw new Error(`Refusing to clear unsafe database: ${databaseName}`);
  }

  await Promise.all(
    Object.values(mongoose.connection.collections).map((collection) =>
      collection.deleteMany({}),
    ),
  );
}

async function disconnectTestDb() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

module.exports = { connectTestDb, clearTestDb, disconnectTestDb };
```

Create `tests/models/user.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");

const User = require("../../models/User");
const { hashPassword, comparePassword } = require("../../services/passwordService");
const { toSafeUser } = require("../../utils/userResponse");
const {
  connectTestDb,
  clearTestDb,
  disconnectTestDb,
} = require("../helpers/testDb");

test.before(async () => {
  await connectTestDb();
});

test.beforeEach(async () => {
  await clearTestDb();
});

test.after(async () => {
  await disconnectTestDb();
});

test("hashPassword uses bcrypt cost 12 and comparePassword verifies it", async () => {
  const hash = await hashPassword("StrongPass1");

  assert.equal(bcrypt.getRounds(hash), 12);
  assert.equal(await comparePassword("StrongPass1", hash), true);
  assert.equal(await comparePassword("WrongPass1", hash), false);
});

test("customer fields normalize and secrets stay out of safe JSON", async () => {
  const user = await User.create({
    username: "  Durai_01  ",
    email: "  DURAI@EXAMPLE.COM  ",
    mobile: "9876543210",
    address: "  Chennai  ",
    passwordHash: await hashPassword("StrongPass1"),
    role: "customer",
  });

  const safe = toSafeUser(user);

  assert.equal(user.username, "durai_01");
  assert.equal(user.email, "durai@example.com");
  assert.equal(user.address, "Chennai");
  assert.equal(safe.id, user.id);
  assert.equal(Object.hasOwn(safe, "passwordHash"), false);
  assert.equal(Object.hasOwn(safe, "tokenVersion"), false);
});

test("customer requires a ten-digit mobile and a non-empty address", async () => {
  const user = new User({
    username: "durai_02",
    email: "durai2@example.com",
    mobile: "123",
    address: "   ",
    passwordHash: await hashPassword("StrongPass1"),
    role: "customer",
  });

  await assert.rejects(user.validate(), /exactly 10 digits|Address is required/);
});
```

- [ ] **Step 2: Run the focused test and verify the expected failure**

Run:

```powershell
npm test -- .\tests\models\user.test.js
```

Expected: FAIL with `Cannot find module '../../models/User'`.

- [ ] **Step 3: Implement the password service**

Create `services/passwordService.js`:

```js
const bcrypt = require("bcryptjs");

const BCRYPT_COST = 12;

async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_COST);
}

async function comparePassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}

module.exports = { BCRYPT_COST, hashPassword, comparePassword };
```

- [ ] **Step 4: Implement the User schema**

Create `models/User.js`:

```js
const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: [true, "Username is required"],
      trim: true,
      lowercase: true,
      minlength: [3, "Username must contain at least 3 characters"],
      maxlength: [30, "Username cannot exceed 30 characters"],
      match: [/^[a-z0-9_]+$/, "Username may contain letters, numbers, and underscore only"],
      unique: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      trim: true,
      lowercase: true,
      unique: true,
    },
    mobile: {
      type: String,
      trim: true,
      validate: {
        validator(value) {
          return this.role !== "customer" || /^\d{10}$/.test(value || "");
        },
        message: "Mobile must contain exactly 10 digits",
      },
    },
    address: {
      type: String,
      trim: true,
      maxlength: [500, "Address cannot exceed 500 characters"],
      validate: {
        validator(value) {
          return this.role !== "customer" || Boolean(value && value.trim());
        },
        message: "Address is required for customers",
      },
    },
    passwordHash: {
      type: String,
      required: [true, "Password hash is required"],
      select: false,
    },
    role: {
      type: String,
      enum: ["customer", "admin"],
      default: "customer",
      required: true,
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      required: true,
    },
    tokenVersion: {
      type: Number,
      default: 0,
      min: 0,
      select: false,
      required: true,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("User", userSchema);
```

Create `utils/userResponse.js`:

```js
function toSafeUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    mobile: user.mobile,
    address: user.address,
    role: user.role,
    isEmailVerified: user.isEmailVerified,
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

module.exports = { toSafeUser };
```

- [ ] **Step 5: Run focused and complete tests**

Run:

```powershell
npm test -- .\tests\models\user.test.js
npm test
```

Expected: all user tests and all existing tests pass.

- [ ] **Step 6: Commit the user domain**

```powershell
git add models/User.js services/passwordService.js utils/userResponse.js tests/helpers/testDb.js tests/models/user.test.js
git commit -m "feat: add secure user model and password hashing"
```

---

### Task 3: Express Security, Validation, Error, and Rate-Limit Foundation

**Files:**
- Create: `server/utils/AppError.js`
- Create: `server/utils/asyncHandler.js`
- Create: `server/middleware/errorHandler.js`
- Create: `server/middleware/notFound.js`
- Create: `server/middleware/originGuard.js`
- Create: `server/middleware/validateRequest.js`
- Create: `server/middleware/rateLimiters.js`
- Create: `server/tests/security/app-security.test.js`
- Modify: `server/app.js`

**Interfaces:**
- Consumes: `readConfig(process.env)` from Task 1.
- Produces: `AppError(statusCode, message, errors)`; `asyncHandler(handler)`; `rejectUnknownFields(allowedFields)`; `validateRequest`; `createAuthRateLimiters(overrides)`; `createApp(options)` and the default Express `app` export.

- [ ] **Step 1: Write failing security and error-contract tests**

Create `tests/security/app-security.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");

const appModule = require("../../app");
const errorHandler = require("../../middleware/errorHandler");
const { createAuthRateLimiters } = require("../../middleware/rateLimiters");

test("health response has security and exact-origin CORS headers", async () => {
  const response = await request(appModule)
    .get("/api/health")
    .set("Origin", "http://localhost:5173");

  assert.equal(response.status, 200);
  assert.equal(response.headers["access-control-allow-origin"], "http://localhost:5173");
  assert.equal(response.headers["access-control-allow-credentials"], "true");
  assert.ok(response.headers["x-content-type-options"]);
});

test("unsafe request from another origin returns the central error shape", async () => {
  const response = await request(appModule)
    .post("/api/not-present")
    .set("Origin", "https://evil.example")
    .send({ value: true });

  assert.equal(response.status, 403);
  assert.deepEqual(response.body, { message: "Request origin is not allowed" });
  assert.equal(Object.hasOwn(response.body, "stack"), false);
});

test("unknown route and oversized JSON use JSON errors", async () => {
  const missing = await request(appModule).get("/api/not-present");
  assert.equal(missing.status, 404);
  assert.deepEqual(missing.body, { message: "Route not found" });

  const oversized = await request(appModule)
    .post("/api/not-present")
    .set("Origin", "http://localhost:5173")
    .send({ value: "x".repeat(21 * 1024) });
  assert.equal(oversized.status, 413);
  assert.equal(oversized.body.message, "JSON body cannot exceed 20 KB");
});

test("database duplicate-key errors become safe 409 field errors without a stack", async () => {
  const probe = express();
  probe.get("/duplicate", (req, res, next) => {
    const error = new Error("database details must not escape");
    error.code = 11000;
    error.keyPattern = { email: 1 };
    next(error);
  });
  probe.use(errorHandler);

  const response = await request(probe).get("/duplicate");
  assert.equal(response.status, 409);
  assert.deepEqual(response.body, {
    message: "email already exists",
    errors: [{ field: "email", message: "email already exists" }],
  });
  assert.equal(Object.hasOwn(response.body, "stack"), false);
});

test("an isolated limiter returns 429 after its configured maximum", async () => {
  const limiter = createAuthRateLimiters({ loginMax: 2 }).login;
  const probe = express();
  probe.set("trust proxy", 1);
  probe.post("/probe", express.json(), limiter, (req, res) => res.json({ ok: true }));

  assert.equal((await request(probe).post("/probe").send({ identifier: "a" })).status, 200);
  assert.equal((await request(probe).post("/probe").send({ identifier: "a" })).status, 200);
  const limited = await request(probe).post("/probe").send({ identifier: "a" });
  assert.equal(limited.status, 429);
  assert.deepEqual(limited.body, { message: "Too many login attempts. Try again later." });
});
```

- [ ] **Step 2: Run the focused test and verify the expected failure**

Run:

```powershell
npm test -- .\tests\security\app-security.test.js
```

Expected: FAIL because `middleware/rateLimiters.js` does not exist.

- [ ] **Step 3: Add reusable errors, async handling, validation, and origins**

Create `utils/AppError.js`:

```js
class AppError extends Error {
  constructor(statusCode, message, errors) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.errors = errors;
  }
}

module.exports = AppError;
```

Create `utils/asyncHandler.js`:

```js
function asyncHandler(handler) {
  return function wrappedHandler(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;
```

Create `middleware/originGuard.js`:

```js
const AppError = require("../utils/AppError");

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function originGuard(allowedOrigin) {
  return function checkOrigin(req, res, next) {
    const origin = req.get("Origin");
    if (SAFE_METHODS.has(req.method) || !origin || origin === allowedOrigin) {
      return next();
    }

    return next(new AppError(403, "Request origin is not allowed"));
  };
}

module.exports = originGuard;
```

Create `middleware/validateRequest.js`:

```js
const { matchedData, validationResult } = require("express-validator");
const AppError = require("../utils/AppError");

function rejectUnknownFields(allowedFields) {
  const allowed = new Set(allowedFields);

  return function checkUnknownFields(req, res, next) {
    const unknown = Object.keys(req.body || {}).filter((field) => !allowed.has(field));
    if (unknown.length === 0) {
      return next();
    }

    return next(
      new AppError(
        400,
        "Request contains unknown fields",
        unknown.map((field) => ({ field, message: "This field is not allowed" })),
      ),
    );
  };
}

function validateRequest(req, res, next) {
  const result = validationResult(req);
  if (!result.isEmpty()) {
    const errors = result.array({ onlyFirstError: true }).map((error) => ({
      field: error.path,
      message: error.msg,
    }));
    return next(new AppError(400, "Validation failed", errors));
  }

  req.validated = matchedData(req, { locations: ["body"] });
  return next();
}

module.exports = { rejectUnknownFields, validateRequest };
```

- [ ] **Step 4: Add central errors and endpoint-specific rate limiters**

Create `middleware/notFound.js`:

```js
const AppError = require("../utils/AppError");

function notFound(req, res, next) {
  next(new AppError(404, "Route not found"));
}

module.exports = notFound;
```

Create `middleware/errorHandler.js`:

```js
function errorHandler(error, req, res, next) {
  let statusCode = error.statusCode || 500;
  let message = error.statusCode ? error.message : "Internal server error";
  let errors = error.errors;

  if (error.code === 11000) {
    const field = Object.keys(error.keyPattern || error.keyValue || {})[0] || "account";
    statusCode = 409;
    message = `${field === "account" ? "Account" : field} already exists`;
    errors = [{ field, message }];
  }

  if (error.type === "entity.too.large") {
    statusCode = 413;
    message = "JSON body cannot exceed 20 KB";
    errors = undefined;
  }

  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    statusCode = 400;
    message = "Request body must contain valid JSON";
    errors = undefined;
  }

  const body = { message };
  if (Array.isArray(errors) && errors.length > 0) {
    body.errors = errors;
  }

  res.status(statusCode).json(body);
}

module.exports = errorHandler;
```

Create `middleware/rateLimiters.js`:

```js
const { ipKeyGenerator, rateLimit } = require("express-rate-limit");

const FIFTEEN_MINUTES = 15 * 60 * 1000;

function accountKey(field) {
  return (req) => {
    const ip = ipKeyGenerator(req.ip);
    const account = String(req.body?.[field] || "unknown").trim().toLowerCase();
    return `${ip}:${account}`;
  };
}

function makeLimiter({ max, message, keyGenerator }) {
  return rateLimit({
    windowMs: FIFTEEN_MINUTES,
    max,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator,
    handler(req, res) {
      res.status(429).json({ message });
    },
  });
}

function createAuthRateLimiters(overrides = {}) {
  const testMaximum = process.env.NODE_ENV === "test" ? 10_000 : undefined;

  return {
    login: makeLimiter({
      max: overrides.loginMax ?? testMaximum ?? 5,
      message: "Too many login attempts. Try again later.",
      keyGenerator: accountKey("identifier"),
    }),
    register: makeLimiter({
      max: overrides.registerMax ?? testMaximum ?? 3,
      message: "Too many registration attempts. Try again later.",
      keyGenerator: accountKey("email"),
    }),
    resendVerification: makeLimiter({
      max: overrides.resendMax ?? testMaximum ?? 3,
      message: "Too many verification requests. Try again later.",
      keyGenerator: accountKey("email"),
    }),
    forgotPassword: makeLimiter({
      max: overrides.recoveryMax ?? testMaximum ?? 3,
      message: "Too many recovery requests. Try again later.",
      keyGenerator: accountKey("email"),
    }),
    adminInvitation: makeLimiter({
      max: overrides.invitationMax ?? testMaximum ?? 3,
      message: "Too many invitation requests. Try again later.",
      keyGenerator: accountKey("email"),
    }),
  };
}

module.exports = { createAuthRateLimiters };
```

- [ ] **Step 5: Compose the secured Express application**

Replace `app.js` with:

```js
const cookieParser = require("cookie-parser");
const cors = require("cors");
const express = require("express");
const helmet = require("helmet");

const { readConfig } = require("./config/env");
const errorHandler = require("./middleware/errorHandler");
const notFound = require("./middleware/notFound");
const originGuard = require("./middleware/originGuard");

function createApp() {
  const config = readConfig();
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(
    cors({
      origin: config.clientUrl,
      credentials: true,
    }),
  );
  app.use(cookieParser());
  app.use(express.json({ limit: "20kb" }));
  app.use(originGuard(config.clientUrl));

  app.get("/api/health", (req, res) => {
    res.status(200).json({ message: "Vehicle Service Booking API is running" });
  });

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

const app = createApp();

module.exports = app;
module.exports.createApp = createApp;
```

- [ ] **Step 6: Run focused and complete verification**

Run:

```powershell
npm test -- .\tests\security\app-security.test.js
npm test
```

Expected: security tests pass; existing health, database, startup, configuration, and model tests pass.

- [ ] **Step 7: Commit the Express foundation**

```powershell
git add app.js utils/AppError.js utils/asyncHandler.js middleware/errorHandler.js middleware/notFound.js middleware/originGuard.js middleware/validateRequest.js middleware/rateLimiters.js tests/security/app-security.test.js
git commit -m "feat: add shared API security and error middleware"
```

---

### Task 4: Hashed Authentication Token Lifecycle

**Files:**
- Create: `server/models/AuthToken.js`
- Create: `server/services/tokenService.js`
- Create: `server/tests/services/token.test.js`

**Interfaces:**
- Consumes: `connectTestDb()`, `clearTestDb()`, and `disconnectTestDb()` from Task 2.
- Produces: `TOKEN_TYPES`; `generateRawToken()`; `hashToken(rawToken)`; `issueAuthToken(userId, type)` returning the usable raw token once; `consumeAuthToken(rawToken, type)` returning the atomically removed record or `null`; `removeAuthTokens(userId, type)`.

- [ ] **Step 1: Write the failing token lifecycle tests**

Create `tests/services/token.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const AuthToken = require("../../models/AuthToken");
const {
  TOKEN_TYPES,
  hashToken,
  issueAuthToken,
  consumeAuthToken,
} = require("../../services/tokenService");
const {
  connectTestDb,
  clearTestDb,
  disconnectTestDb,
} = require("../helpers/testDb");

test.before(connectTestDb);
test.beforeEach(clearTestDb);
test.after(disconnectTestDb);

test("issuing a token stores only its SHA-256 hash and replaces the old token", async () => {
  const userId = new mongoose.Types.ObjectId();
  const firstRaw = await issueAuthToken(userId, TOKEN_TYPES.EMAIL_VERIFICATION);
  const secondRaw = await issueAuthToken(userId, TOKEN_TYPES.EMAIL_VERIFICATION);
  const records = await AuthToken.find({ userId });

  assert.match(firstRaw, /^[a-f0-9]{64}$/);
  assert.match(secondRaw, /^[a-f0-9]{64}$/);
  assert.notEqual(firstRaw, secondRaw);
  assert.equal(records.length, 1);
  assert.equal(records[0].tokenHash, hashToken(secondRaw));
  assert.notEqual(records[0].tokenHash, secondRaw);
});

test("a valid token is consumed exactly once", async () => {
  const userId = new mongoose.Types.ObjectId();
  const raw = await issueAuthToken(userId, TOKEN_TYPES.PASSWORD_RESET);

  const firstUse = await consumeAuthToken(raw, TOKEN_TYPES.PASSWORD_RESET);
  const secondUse = await consumeAuthToken(raw, TOKEN_TYPES.PASSWORD_RESET);

  assert.equal(firstUse.userId.toString(), userId.toString());
  assert.equal(secondUse, null);
});

test("expired and malformed tokens are rejected", async () => {
  const raw = "a".repeat(64);
  await AuthToken.create({
    userId: new mongoose.Types.ObjectId(),
    type: TOKEN_TYPES.EMAIL_VERIFICATION,
    tokenHash: hashToken(raw),
    expiresAt: new Date(Date.now() - 1000),
  });

  assert.equal(await consumeAuthToken(raw, TOKEN_TYPES.EMAIL_VERIFICATION), null);
  assert.throws(() => hashToken("not-a-token"), /64 lowercase hexadecimal/);
});
```

- [ ] **Step 2: Run the focused test and verify the expected failure**

Run:

```powershell
npm test -- .\tests\services\token.test.js
```

Expected: FAIL because `models/AuthToken.js` does not exist.

- [ ] **Step 3: Implement the AuthToken schema**

Create `models/AuthToken.js`:

```js
const mongoose = require("mongoose");

const authTokenSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  type: {
    type: String,
    enum: ["email_verification", "password_reset"],
    required: true,
  },
  tokenHash: {
    type: String,
    required: true,
    unique: true,
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expires: 0 },
  },
  createdAt: {
    type: Date,
    default: Date.now,
    immutable: true,
  },
});

authTokenSchema.index({ userId: 1, type: 1 }, { unique: true });

module.exports = mongoose.model("AuthToken", authTokenSchema);
```

- [ ] **Step 4: Implement random generation, hashing, replacement, and atomic consumption**

Create `services/tokenService.js`:

```js
const crypto = require("node:crypto");

const AuthToken = require("../models/AuthToken");

const TOKEN_TYPES = Object.freeze({
  EMAIL_VERIFICATION: "email_verification",
  PASSWORD_RESET: "password_reset",
});

const TOKEN_LIFETIMES = Object.freeze({
  [TOKEN_TYPES.EMAIL_VERIFICATION]: 60 * 60 * 1000,
  [TOKEN_TYPES.PASSWORD_RESET]: 15 * 60 * 1000,
});

function generateRawToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashToken(rawToken) {
  if (!/^[a-f0-9]{64}$/.test(String(rawToken))) {
    throw new Error("Token must contain 64 lowercase hexadecimal characters");
  }

  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

async function issueAuthToken(userId, type) {
  const lifetime = TOKEN_LIFETIMES[type];
  if (!lifetime) {
    throw new Error(`Unsupported authentication token type: ${type}`);
  }

  const rawToken = generateRawToken();
  await AuthToken.findOneAndDelete({ userId, type });
  await AuthToken.create({
    userId,
    type,
    tokenHash: hashToken(rawToken),
    expiresAt: new Date(Date.now() + lifetime),
  });
  return rawToken;
}

async function consumeAuthToken(rawToken, type) {
  let tokenHash;
  try {
    tokenHash = hashToken(rawToken);
  } catch {
    return null;
  }

  return AuthToken.findOneAndDelete({
    tokenHash,
    type,
    expiresAt: { $gt: new Date() },
  });
}

async function removeAuthTokens(userId, type) {
  return AuthToken.deleteMany({ userId, ...(type ? { type } : {}) });
}

module.exports = {
  TOKEN_TYPES,
  generateRawToken,
  hashToken,
  issueAuthToken,
  consumeAuthToken,
  removeAuthTokens,
};
```

- [ ] **Step 5: Run focused and complete tests**

Run:

```powershell
npm test -- .\tests\services\token.test.js
npm test
```

Expected: token tests and the full suite pass.

- [ ] **Step 6: Commit the token lifecycle**

```powershell
git add models/AuthToken.js services/tokenService.js tests/services/token.test.js
git commit -m "feat: add single-use hashed authentication tokens"
```

---

### Task 5: Injectable Gmail Email Service

**Files:**
- Create: `server/config/email.js`
- Create: `server/services/emailService.js`
- Create: `server/tests/services/email.test.js`
- Modify: `server/config/env.js`
- Modify locally only: `server/.env`

**Interfaces:**
- Consumes: `config.clientUrl` and Gmail environment values.
- Produces: `createEmailTransport(config)`; `sendVerificationEmail({ to, token })`; `sendPasswordResetEmail({ to, token })`; `setTransporterForTests(fakeTransporter)`; `resetTransporterForTests()`.

- [ ] **Step 1: Write the failing injected-email tests**

Create `tests/services/email.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");

const emailService = require("../../services/emailService");

test.afterEach(() => {
  emailService.resetTransporterForTests();
});

test("verification email uses the configured frontend URL and injected transport", async () => {
  const sent = [];
  emailService.setTransporterForTests({
    async sendMail(message) {
      sent.push(message);
      return { messageId: "test-message" };
    },
  });

  await emailService.sendVerificationEmail({
    to: "durai@example.com",
    token: "a".repeat(64),
  });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "durai@example.com");
  assert.match(
    sent[0].text,
    /http:\/\/localhost:5173\/verify-email\?token=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/,
  );
});

test("password reset email uses the reset path", async () => {
  const sent = [];
  emailService.setTransporterForTests({
    async sendMail(message) {
      sent.push(message);
      return { messageId: "test-message" };
    },
  });

  await emailService.sendPasswordResetEmail({
    to: "durai@example.com",
    token: "b".repeat(64),
  });

  assert.match(sent[0].text, /\/reset-password\?token=bbbb/);
});
```

- [ ] **Step 2: Run the focused test and verify the expected failure**

Run:

```powershell
npm test -- .\tests\services\email.test.js
```

Expected: FAIL because `services/emailService.js` does not exist.

- [ ] **Step 3: Add Gmail configuration without exposing credentials**

Add `"GMAIL_USER"` and `"GMAIL_APP_PASSWORD"` to `REQUIRED_NAMES` in `config/env.js`. Then extend the object returned by `readConfig()` with:

```js
gmailUser: source.GMAIL_USER,
gmailAppPassword: source.GMAIL_APP_PASSWORD,
```

Create `config/email.js`:

```js
const nodemailer = require("nodemailer");

function createEmailTransport(config) {
  if (!config.gmailUser || !config.gmailAppPassword) {
    throw new Error("Gmail email settings are not configured");
  }

  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: config.gmailUser,
      pass: config.gmailAppPassword,
    },
  });
}

module.exports = { createEmailTransport };
```

- [ ] **Step 4: Implement the injectable email service**

Create `services/emailService.js`:

```js
const { createEmailTransport } = require("../config/email");
const { readConfig } = require("../config/env");

let testTransporter = null;

function getSettings() {
  return readConfig();
}

function getTransporter() {
  return testTransporter || createEmailTransport(getSettings());
}

function setTransporterForTests(transporter) {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Email transporter injection is allowed only in tests");
  }
  testTransporter = transporter;
}

function resetTransporterForTests() {
  testTransporter = null;
}

async function sendVerificationEmail({ to, token }) {
  const config = getSettings();
  const link = `${config.clientUrl}/verify-email?token=${encodeURIComponent(token)}`;
  return getTransporter().sendMail({
    from: config.gmailUser,
    to,
    subject: "Verify your Vehicle Service Booking email",
    text: `Open this link within 60 minutes to verify your email: ${link}`,
  });
}

async function sendPasswordResetEmail({ to, token }) {
  const config = getSettings();
  const link = `${config.clientUrl}/reset-password?token=${encodeURIComponent(token)}`;
  return getTransporter().sendMail({
    from: config.gmailUser,
    to,
    subject: "Reset your Vehicle Service Booking password",
    text: `Open this link within 15 minutes to reset your password: ${link}`,
  });
}

module.exports = {
  sendVerificationEmail,
  sendPasswordResetEmail,
  setTransporterForTests,
  resetTransporterForTests,
};
```

- [ ] **Step 5: Run the injected tests before configuring real Gmail**

Run:

```powershell
npm test -- .\tests\services\email.test.js
npm test
```

Expected: all tests pass without sending any real email.

- [ ] **Step 6: Configure real Gmail locally**

In the Google account used for development, enable two-step verification and create a Gmail App Password. Add these two lines to the untracked `.env` using the actual Gmail address and App Password:

```dotenv
GMAIL_USER=the-development-gmail-address
GMAIL_APP_PASSWORD=the-16-character-google-app-password
```

Security check:

```powershell
git check-ignore .env
git status --short
```

Expected: `git check-ignore` prints `.env`, and `git status --short` does not list `.env`.

- [ ] **Step 7: Commit the email service without `.env`**

```powershell
git add config/env.js config/email.js services/emailService.js tests/services/email.test.js
git commit -m "feat: add injectable Gmail email service"
```

---

### Task 6: Customer Registration API

**Files:**
- Create: `server/validators/authValidators.js`
- Create: `server/services/authService.js`
- Create: `server/controllers/authController.js`
- Create: `server/routes/authRoutes.js`
- Create: `server/tests/auth/register.test.js`
- Modify: `server/app.js`

**Interfaces:**
- Consumes: `User`, `hashPassword()`, `issueAuthToken()`, `sendVerificationEmail()`, `toSafeUser()`, shared validation/error middleware, and `rateLimiters.register`.
- Produces: `registerCustomer(input)` returning `{ user, emailSent }`; `register` controller; `POST /api/auth/register`.

- [ ] **Step 1: Write failing customer-registration API tests**

Create `tests/auth/register.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../../app");
const User = require("../../models/User");
const emailService = require("../../services/emailService");
const {
  connectTestDb,
  clearTestDb,
  disconnectTestDb,
} = require("../helpers/testDb");

const validCustomer = {
  username: "durai_01",
  email: "durai@example.com",
  mobile: "9876543210",
  address: "Chennai",
  password: "StrongPass1",
};

let sentEmails;

test.before(connectTestDb);
test.beforeEach(async () => {
  await clearTestDb();
  sentEmails = [];
  emailService.setTransporterForTests({
    async sendMail(message) {
      sentEmails.push(message);
      return { messageId: "registration-test" };
    },
  });
});
test.afterEach(emailService.resetTransporterForTests);
test.after(disconnectTestDb);

test("POST /api/auth/register creates an unverified customer and sends a link", async () => {
  const response = await request(app)
    .post("/api/auth/register")
    .set("Origin", "http://localhost:5173")
    .send(validCustomer);

  assert.equal(response.status, 201);
  assert.equal(response.body.emailSent, true);
  assert.equal(response.body.user.role, "customer");
  assert.equal(response.body.user.isEmailVerified, false);
  assert.equal(Object.hasOwn(response.body.user, "passwordHash"), false);
  assert.equal(Object.hasOwn(response.body, "token"), false);
  assert.equal(sentEmails.length, 1);

  const stored = await User.findOne({ email: "durai@example.com" }).select("+passwordHash");
  assert.ok(stored.passwordHash.startsWith("$2"));
  assert.notEqual(stored.passwordHash, validCustomer.password);
});

test("registration rejects role and other unknown fields", async () => {
  const response = await request(app)
    .post("/api/auth/register")
    .set("Origin", "http://localhost:5173")
    .send({ ...validCustomer, role: "admin" });

  assert.equal(response.status, 400);
  assert.deepEqual(response.body.errors, [
    { field: "role", message: "This field is not allowed" },
  ]);
  assert.equal(await User.countDocuments(), 0);
});

test("registration returns a readable conflict for a duplicate email", async () => {
  await request(app)
    .post("/api/auth/register")
    .set("Origin", "http://localhost:5173")
    .send(validCustomer);

  const response = await request(app)
    .post("/api/auth/register")
    .set("Origin", "http://localhost:5173")
    .send({ ...validCustomer, username: "different_user" });

  assert.equal(response.status, 409);
  assert.equal(response.body.message, "Email already exists");
});

test("registration returns a readable conflict for a duplicate username", async () => {
  await request(app)
    .post("/api/auth/register")
    .set("Origin", "http://localhost:5173")
    .send(validCustomer);

  const response = await request(app)
    .post("/api/auth/register")
    .set("Origin", "http://localhost:5173")
    .send({ ...validCustomer, email: "different@example.com" });

  assert.equal(response.status, 409);
  assert.equal(response.body.message, "Username already exists");
});

test("registration keeps the unverified account when Gmail fails", async () => {
  emailService.setTransporterForTests({
    async sendMail() {
      throw new Error("test delivery failure");
    },
  });

  const response = await request(app)
    .post("/api/auth/register")
    .set("Origin", "http://localhost:5173")
    .send(validCustomer);

  assert.equal(response.status, 201);
  assert.equal(response.body.emailSent, false);
  assert.equal(await User.countDocuments({ isEmailVerified: false }), 1);
  assert.equal(JSON.stringify(response.body).includes("test delivery failure"), false);
});
```

- [ ] **Step 2: Run the focused test and verify the expected failure**

Run:

```powershell
npm test -- .\tests\auth\register.test.js
```

Expected: FAIL with `404 !== 201` because `/api/auth/register` is not mounted.

- [ ] **Step 3: Create reusable registration validation**

Create `validators/authValidators.js`:

```js
const { body } = require("express-validator");

function normalizedEmail(field = "email") {
  return body(field)
    .isString()
    .withMessage("Email must be text")
    .bail()
    .trim()
    .isEmail()
    .withMessage("Email must be valid")
    .customSanitizer((value) => value.toLowerCase());
}

function strongPassword(field) {
  return body(field)
    .isString()
    .withMessage("Password must be text")
    .bail()
    .isLength({ min: 8, max: 72 })
    .withMessage("Password must contain 8 to 72 characters")
    .matches(/[A-Z]/)
    .withMessage("Password must contain an uppercase letter")
    .matches(/[a-z]/)
    .withMessage("Password must contain a lowercase letter")
    .matches(/[0-9]/)
    .withMessage("Password must contain a number");
}

const registerValidation = [
  body("username")
    .isString()
    .withMessage("Username must be text")
    .bail()
    .trim()
    .toLowerCase()
    .isLength({ min: 3, max: 30 })
    .withMessage("Username must contain 3 to 30 characters")
    .matches(/^[a-z0-9_]+$/)
    .withMessage("Username may contain letters, numbers, and underscore only"),
  normalizedEmail(),
  body("mobile")
    .isString()
    .withMessage("Mobile must be text")
    .bail()
    .trim()
    .matches(/^\d{10}$/)
    .withMessage("Mobile must contain exactly 10 digits"),
  body("address")
    .isString()
    .withMessage("Address must be text")
    .bail()
    .trim()
    .notEmpty()
    .withMessage("Address is required")
    .isLength({ max: 500 })
    .withMessage("Address cannot exceed 500 characters"),
  strongPassword("password"),
];

module.exports = { normalizedEmail, strongPassword, registerValidation };
```

- [ ] **Step 4: Implement registration business logic**

Create `services/authService.js`:

```js
const User = require("../models/User");
const AppError = require("../utils/AppError");
const emailService = require("./emailService");
const { hashPassword } = require("./passwordService");
const { issueAuthToken, TOKEN_TYPES } = require("./tokenService");

async function registerCustomer(input) {
  const conflict = await User.findOne({
    $or: [{ email: input.email }, { username: input.username }],
  }).lean();

  if (conflict) {
    const field = conflict.email === input.email ? "Email" : "Username";
    throw new AppError(409, `${field} already exists`);
  }

  const user = await User.create({
    username: input.username,
    email: input.email,
    mobile: input.mobile,
    address: input.address,
    passwordHash: await hashPassword(input.password),
    role: "customer",
    isEmailVerified: false,
    isActive: true,
  });

  const token = await issueAuthToken(user._id, TOKEN_TYPES.EMAIL_VERIFICATION);
  let emailSent = true;
  try {
    await emailService.sendVerificationEmail({ to: user.email, token });
  } catch {
    emailSent = false;
  }

  return { user, emailSent };
}

module.exports = { registerCustomer };
```

- [ ] **Step 5: Add the controller and route**

Create `controllers/authController.js`:

```js
const authService = require("../services/authService");
const { toSafeUser } = require("../utils/userResponse");

async function register(req, res) {
  const result = await authService.registerCustomer(req.validated);
  const message = result.emailSent
    ? "Registration successful. Check your email to verify the account."
    : "Registration successful, but the email could not be sent. Use resend verification.";

  res.status(201).json({
    message,
    emailSent: result.emailSent,
    user: toSafeUser(result.user),
  });
}

module.exports = { register };
```

Create `routes/authRoutes.js`:

```js
const express = require("express");

const authController = require("../controllers/authController");
const asyncHandler = require("../utils/asyncHandler");
const { rejectUnknownFields, validateRequest } = require("../middleware/validateRequest");
const { registerValidation } = require("../validators/authValidators");

function createAuthRouter({ rateLimiters }) {
  const router = express.Router();

  router.post(
    "/register",
    rateLimiters.register,
    rejectUnknownFields(["username", "email", "mobile", "address", "password"]),
    registerValidation,
    validateRequest,
    asyncHandler(authController.register),
  );

  return router;
}

module.exports = createAuthRouter;
```

- [ ] **Step 6: Mount the authentication router before the 404 middleware**

Add these imports to `app.js`:

```js
const { createAuthRateLimiters } = require("./middleware/rateLimiters");
const createAuthRouter = require("./routes/authRoutes");
```

Change the function signature and add the route after `/api/health` but before `app.use(notFound)`:

```js
function createApp({ rateLimiters = createAuthRateLimiters() } = {}) {
```

```js
app.use("/api/auth", createAuthRouter({ rateLimiters }));
```

- [ ] **Step 7: Run focused and complete tests**

Run:

```powershell
npm test -- .\tests\auth\register.test.js
npm test
```

Expected: all five registration tests and the full suite pass.

- [ ] **Step 8: Commit customer registration**

```powershell
git add app.js validators/authValidators.js services/authService.js controllers/authController.js routes/authRoutes.js tests/auth/register.test.js
git commit -m "feat: add secure customer registration"
```

---

### Task 7: Email Verification and Neutral Resend

**Files:**
- Create: `server/tests/auth/verification.test.js`
- Modify: `server/validators/authValidators.js`
- Modify: `server/services/authService.js`
- Modify: `server/controllers/authController.js`
- Modify: `server/routes/authRoutes.js`

**Interfaces:**
- Consumes: `consumeAuthToken()`, `issueAuthToken()`, `TOKEN_TYPES.EMAIL_VERIFICATION`, and `sendVerificationEmail()`.
- Produces: `verifyEmail(token)`; `resendVerification(email)`; `POST /api/auth/verify-email`; `POST /api/auth/resend-verification`.

- [ ] **Step 1: Write failing verification and resend tests**

Create `tests/auth/verification.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../../app");
const User = require("../../models/User");
const emailService = require("../../services/emailService");
const { hashPassword } = require("../../services/passwordService");
const {
  connectTestDb,
  clearTestDb,
  disconnectTestDb,
} = require("../helpers/testDb");

let sentEmails;

function tokenFromEmail(message) {
  const match = message.text.match(/token=([a-f0-9]{64})/);
  assert.ok(match, "email must contain a 64-character token");
  return match[1];
}

async function createUnverifiedUser() {
  return User.create({
    username: "durai_01",
    email: "durai@example.com",
    mobile: "9876543210",
    address: "Chennai",
    passwordHash: await hashPassword("StrongPass1"),
    role: "customer",
    isEmailVerified: false,
  });
}

test.before(connectTestDb);
test.beforeEach(async () => {
  await clearTestDb();
  sentEmails = [];
  emailService.setTransporterForTests({
    async sendMail(message) {
      sentEmails.push(message);
      return { messageId: "verification-test" };
    },
  });
});
test.afterEach(emailService.resetTransporterForTests);
test.after(disconnectTestDb);

test("verification token verifies the account exactly once", async () => {
  const user = await createUnverifiedUser();
  await request(app)
    .post("/api/auth/resend-verification")
    .set("Origin", "http://localhost:5173")
    .send({ email: user.email });
  const token = tokenFromEmail(sentEmails[0]);

  const first = await request(app)
    .post("/api/auth/verify-email")
    .set("Origin", "http://localhost:5173")
    .send({ token });
  const second = await request(app)
    .post("/api/auth/verify-email")
    .set("Origin", "http://localhost:5173")
    .send({ token });

  assert.equal(first.status, 200);
  assert.equal(second.status, 400);
  assert.equal(second.body.message, "This link is invalid or expired");
  assert.equal((await User.findById(user._id)).isEmailVerified, true);
});

test("resend response is neutral for unknown, verified, and eligible email", async () => {
  const neutralMessage =
    "If the account can be verified, a new verification email has been sent.";
  const unknown = await request(app)
    .post("/api/auth/resend-verification")
    .set("Origin", "http://localhost:5173")
    .send({ email: "unknown@example.com" });

  const verifiedUser = await createUnverifiedUser();
  verifiedUser.isEmailVerified = true;
  await verifiedUser.save();
  const verified = await request(app)
    .post("/api/auth/resend-verification")
    .set("Origin", "http://localhost:5173")
    .send({ email: verifiedUser.email });

  verifiedUser.isEmailVerified = false;
  await verifiedUser.save();
  const eligible = await request(app)
    .post("/api/auth/resend-verification")
    .set("Origin", "http://localhost:5173")
    .send({ email: verifiedUser.email });

  assert.equal(unknown.body.message, neutralMessage);
  assert.equal(verified.body.message, neutralMessage);
  assert.equal(eligible.body.message, neutralMessage);
  assert.equal(sentEmails.length, 1);
});

test("explicit resend returns 502 when Gmail fails", async () => {
  const user = await createUnverifiedUser();
  emailService.setTransporterForTests({
    async sendMail() {
      throw new Error("test delivery failure");
    },
  });

  const response = await request(app)
    .post("/api/auth/resend-verification")
    .set("Origin", "http://localhost:5173")
    .send({ email: user.email });

  assert.equal(response.status, 502);
  assert.equal(response.body.message, "Verification email could not be sent");
});
```

- [ ] **Step 2: Run the focused test and verify the expected failure**

Run:

```powershell
npm test -- .\tests\auth\verification.test.js
```

Expected: FAIL with `404` responses because the two routes do not exist.

- [ ] **Step 3: Add token and email-only validators**

Add to `validators/authValidators.js` before `module.exports`:

```js
const tokenValidation = [
  body("token")
    .isString()
    .withMessage("Token must be text")
    .bail()
    .matches(/^[a-f0-9]{64}$/)
    .withMessage("Token must contain 64 lowercase hexadecimal characters"),
];

const emailValidation = [normalizedEmail()];
```

Replace its export with:

```js
module.exports = {
  normalizedEmail,
  strongPassword,
  registerValidation,
  tokenValidation,
  emailValidation,
};
```

- [ ] **Step 4: Implement verification and resend business logic**

Add `consumeAuthToken` to the token-service import in `services/authService.js`, then add:

```js
const RESEND_MESSAGE =
  "If the account can be verified, a new verification email has been sent.";

async function verifyEmail(token) {
  const record = await consumeAuthToken(token, TOKEN_TYPES.EMAIL_VERIFICATION);
  if (!record) {
    throw new AppError(400, "This link is invalid or expired");
  }

  const user = await User.findByIdAndUpdate(
    record.userId,
    { $set: { isEmailVerified: true } },
    { new: true },
  );
  if (!user) {
    throw new AppError(400, "This link is invalid or expired");
  }
  return user;
}

async function resendVerification(email) {
  const user = await User.findOne({ email });
  if (!user || user.isEmailVerified || !user.isActive) {
    return { message: RESEND_MESSAGE };
  }

  const token = await issueAuthToken(user._id, TOKEN_TYPES.EMAIL_VERIFICATION);
  try {
    await emailService.sendVerificationEmail({ to: user.email, token });
  } catch {
    throw new AppError(502, "Verification email could not be sent");
  }

  return { message: RESEND_MESSAGE };
}
```

Replace the service export with:

```js
module.exports = { registerCustomer, verifyEmail, resendVerification };
```

- [ ] **Step 5: Add controllers and routes**

Add to `controllers/authController.js`:

```js
async function verifyEmail(req, res) {
  await authService.verifyEmail(req.validated.token);
  res.status(200).json({ message: "Email verified successfully. You can now log in." });
}

async function resendVerification(req, res) {
  const result = await authService.resendVerification(req.validated.email);
  res.status(200).json(result);
}
```

Replace its export with:

```js
module.exports = { register, verifyEmail, resendVerification };
```

Add `tokenValidation` and `emailValidation` to the validator import in `routes/authRoutes.js`, then add these routes after `/register`:

```js
router.post(
  "/verify-email",
  rejectUnknownFields(["token"]),
  tokenValidation,
  validateRequest,
  asyncHandler(authController.verifyEmail),
);

router.post(
  "/resend-verification",
  rateLimiters.resendVerification,
  rejectUnknownFields(["email"]),
  emailValidation,
  validateRequest,
  asyncHandler(authController.resendVerification),
);
```

- [ ] **Step 6: Run focused and complete tests**

Run:

```powershell
npm test -- .\tests\auth\verification.test.js
npm test
```

Expected: all verification tests and the full suite pass.

- [ ] **Step 7: Commit email verification**

```powershell
git add validators/authValidators.js services/authService.js controllers/authController.js routes/authRoutes.js tests/auth/verification.test.js
git commit -m "feat: add single-use email verification"
```

---

### Task 8: Cookie Login, Current User, Logout, and Role Middleware

**Files:**
- Create: `server/services/jwtService.js`
- Create: `server/utils/authCookie.js`
- Create: `server/middleware/authenticate.js`
- Create: `server/middleware/authorize.js`
- Create: `server/tests/auth/session.test.js`
- Modify: `server/validators/authValidators.js`
- Modify: `server/services/authService.js`
- Modify: `server/controllers/authController.js`
- Modify: `server/routes/authRoutes.js`

**Interfaces:**
- Consumes: current `User`, bcrypt comparison, `readConfig()`, and `toSafeUser()`.
- Produces: `signAuthToken(user)`; `verifyAuthToken(token)`; `setAuthCookie(res, token)`; `clearAuthCookie(res)`; `authenticate`; `authorize(...roles)`; `login(input)`; `POST /api/auth/login`; `POST /api/auth/logout`; `GET /api/auth/me`.

- [ ] **Step 1: Write failing session API tests**

Create `tests/auth/session.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const request = require("supertest");

const app = require("../../app");
const { readConfig } = require("../../config/env");
const User = require("../../models/User");
const { hashPassword } = require("../../services/passwordService");
const { setAuthCookie } = require("../../utils/authCookie");
const {
  connectTestDb,
  clearTestDb,
  disconnectTestDb,
} = require("../helpers/testDb");

async function createUser(overrides = {}) {
  return User.create({
    username: "durai_01",
    email: "durai@example.com",
    mobile: "9876543210",
    address: "Chennai",
    passwordHash: await hashPassword("StrongPass1"),
    role: "customer",
    isEmailVerified: true,
    isActive: true,
    ...overrides,
  });
}

test.before(connectTestDb);
test.beforeEach(clearTestDb);
test.after(disconnectTestDb);

test("login by email sets a safe eight-hour HttpOnly cookie with a minimal JWT", async () => {
  const user = await createUser();
  const response = await request(app)
    .post("/api/auth/login")
    .set("Origin", "http://localhost:5173")
    .send({ identifier: "DURAI@EXAMPLE.COM", password: "StrongPass1" });

  assert.equal(response.status, 200);
  const cookie = response.headers["set-cookie"][0];
  assert.match(cookie, /^vsb_auth=/);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
  assert.match(cookie, /Max-Age=28800/i);
  assert.doesNotMatch(cookie, /Secure/i);
  assert.equal(Object.hasOwn(response.body, "token"), false);

  const encoded = cookie.match(/^vsb_auth=([^;]+)/)[1];
  const payload = jwt.decode(encoded);
  assert.deepEqual(Object.keys(payload).sort(), ["aud", "exp", "iat", "iss", "sub", "ver"]);
  assert.equal(payload.sub, user.id);
});

test("login by username can read /me and logout clears the cookie", async () => {
  await createUser();
  const login = await request(app)
    .post("/api/auth/login")
    .set("Origin", "http://localhost:5173")
    .send({ identifier: "DURAI_01", password: "StrongPass1" });
  const cookie = login.headers["set-cookie"][0];

  const current = await request(app).get("/api/auth/me").set("Cookie", cookie);
  const logout = await request(app)
    .post("/api/auth/logout")
    .set("Origin", "http://localhost:5173")
    .set("Cookie", cookie);

  assert.equal(current.status, 200);
  assert.equal(current.body.user.email, "durai@example.com");
  assert.equal(Object.hasOwn(current.body.user, "tokenVersion"), false);
  assert.equal(logout.status, 200);
  assert.match(logout.headers["set-cookie"][0], /^vsb_auth=;/);
});

test("production cookie adds the Secure attribute", async () => {
  const originalMode = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const probe = express();
    probe.get("/cookie", (req, res) => {
      setAuthCookie(res, "test-token");
      res.json({ ok: true });
    });
    const response = await request(probe).get("/cookie");
    assert.match(response.headers["set-cookie"][0], /Secure/i);
  } finally {
    process.env.NODE_ENV = originalMode;
  }
});

test("login rejects generic bad credentials and specific unavailable accounts", async () => {
  await createUser();
  const bad = await request(app)
    .post("/api/auth/login")
    .set("Origin", "http://localhost:5173")
    .send({ identifier: "durai@example.com", password: "WrongPass1" });

  await User.updateOne({ email: "durai@example.com" }, { isEmailVerified: false });
  const unverified = await request(app)
    .post("/api/auth/login")
    .set("Origin", "http://localhost:5173")
    .send({ identifier: "durai@example.com", password: "StrongPass1" });

  await User.updateOne(
    { email: "durai@example.com" },
    { isEmailVerified: true, isActive: false },
  );
  const inactive = await request(app)
    .post("/api/auth/login")
    .set("Origin", "http://localhost:5173")
    .send({ identifier: "durai@example.com", password: "StrongPass1" });

  assert.equal(bad.status, 401);
  assert.equal(bad.body.message, "Incorrect email, username, or password");
  assert.equal(unverified.status, 403);
  assert.equal(inactive.status, 403);
});

test("/me rejects missing, malformed, and stale authentication", async () => {
  const user = await createUser();
  const missing = await request(app).get("/api/auth/me");
  const malformed = await request(app).get("/api/auth/me").set("Cookie", "vsb_auth=bad");

  const login = await request(app)
    .post("/api/auth/login")
    .set("Origin", "http://localhost:5173")
    .send({ identifier: user.email, password: "StrongPass1" });
  await User.updateOne({ _id: user._id }, { $inc: { tokenVersion: 1 } });
  const stale = await request(app)
    .get("/api/auth/me")
    .set("Cookie", login.headers["set-cookie"][0]);

  assert.equal(missing.status, 401);
  assert.equal(malformed.status, 401);
  assert.equal(stale.status, 401);
});

test("/me reloads account state and rejects expired, inactive, and unverified access", async () => {
  const user = await createUser();
  const config = readConfig();
  const expiredToken = jwt.sign(
    { sub: user.id, ver: 0 },
    config.jwtSecret,
    {
      expiresIn: -1,
      issuer: "vehicle-service-booking",
      audience: "vehicle-service-booking-web",
    },
  );
  const expired = await request(app)
    .get("/api/auth/me")
    .set("Cookie", `vsb_auth=${expiredToken}`);

  const login = await request(app)
    .post("/api/auth/login")
    .set("Origin", "http://localhost:5173")
    .send({ identifier: user.email, password: "StrongPass1" });
  const cookie = login.headers["set-cookie"][0];

  await User.updateOne({ _id: user._id }, { isActive: false });
  const inactive = await request(app).get("/api/auth/me").set("Cookie", cookie);
  await User.updateOne(
    { _id: user._id },
    { isActive: true, isEmailVerified: false },
  );
  const unverified = await request(app).get("/api/auth/me").set("Cookie", cookie);

  assert.equal(expired.status, 401);
  assert.equal(inactive.status, 403);
  assert.equal(unverified.status, 403);
});
```

- [ ] **Step 2: Run the focused test and verify the expected failure**

Run:

```powershell
npm test -- .\tests\auth\session.test.js
```

Expected: FAIL with `404` because login and current-user routes are absent.

- [ ] **Step 3: Implement minimal JWT and cookie helpers**

Create `services/jwtService.js`:

```js
const jwt = require("jsonwebtoken");
const { readConfig } = require("../config/env");

const ISSUER = "vehicle-service-booking";
const AUDIENCE = "vehicle-service-booking-web";

function signAuthToken(user) {
  const config = readConfig();
  return jwt.sign(
    { sub: user.id, ver: user.tokenVersion },
    config.jwtSecret,
    {
      expiresIn: config.jwtExpiresIn,
      issuer: ISSUER,
      audience: AUDIENCE,
    },
  );
}

function verifyAuthToken(token) {
  const config = readConfig();
  return jwt.verify(token, config.jwtSecret, {
    issuer: ISSUER,
    audience: AUDIENCE,
  });
}

module.exports = { signAuthToken, verifyAuthToken };
```

Create `utils/authCookie.js`:

```js
const { readConfig } = require("../config/env");

const AUTH_COOKIE_NAME = "vsb_auth";
const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;

function baseCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: readConfig().isProduction,
    path: "/",
  };
}

function setAuthCookie(res, token) {
  res.cookie(AUTH_COOKIE_NAME, token, {
    ...baseCookieOptions(),
    maxAge: EIGHT_HOURS_MS,
  });
}

function clearAuthCookie(res) {
  res.clearCookie(AUTH_COOKIE_NAME, baseCookieOptions());
}

module.exports = { AUTH_COOKIE_NAME, setAuthCookie, clearAuthCookie };
```

- [ ] **Step 4: Implement authentication and current-role authorization middleware**

Create `middleware/authenticate.js`:

```js
const User = require("../models/User");
const { verifyAuthToken } = require("../services/jwtService");
const AppError = require("../utils/AppError");
const { AUTH_COOKIE_NAME } = require("../utils/authCookie");

async function authenticate(req, res, next) {
  const token = req.cookies?.[AUTH_COOKIE_NAME];
  if (!token) {
    return next(new AppError(401, "Authentication required"));
  }

  let payload;
  try {
    payload = verifyAuthToken(token);
  } catch {
    return next(new AppError(401, "Authentication is invalid or expired"));
  }

  const user = await User.findById(payload.sub).select("+tokenVersion");
  if (!user || user.tokenVersion !== payload.ver) {
    return next(new AppError(401, "Authentication is invalid or expired"));
  }
  if (!user.isActive) {
    return next(new AppError(403, "Account is inactive"));
  }
  if (!user.isEmailVerified) {
    return next(new AppError(403, "Email verification is required"));
  }

  req.user = user;
  return next();
}

module.exports = authenticate;
```

Create `middleware/authorize.js`:

```js
const AppError = require("../utils/AppError");

function authorize(...allowedRoles) {
  return function checkRole(req, res, next) {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return next(new AppError(403, "You do not have permission for this action"));
    }
    return next();
  };
}

module.exports = authorize;
```

- [ ] **Step 5: Add login validation and business logic**

Add to `validators/authValidators.js`:

```js
const loginValidation = [
  body("identifier")
    .isString()
    .withMessage("Email or username must be text")
    .bail()
    .trim()
    .notEmpty()
    .withMessage("Email or username is required")
    .customSanitizer((value) => value.toLowerCase()),
  body("password").isString().withMessage("Password must be text").notEmpty().withMessage("Password is required"),
];
```

Add `loginValidation` to the validator module export.

Add `comparePassword` to the password-service import in `services/authService.js`, then add:

```js
async function login(input) {
  const identifier = input.identifier.toLowerCase();
  const user = await User.findOne({
    $or: [{ email: identifier }, { username: identifier }],
  }).select("+passwordHash +tokenVersion");

  if (!user || !(await comparePassword(input.password, user.passwordHash))) {
    throw new AppError(401, "Incorrect email, username, or password");
  }
  if (!user.isActive) {
    throw new AppError(403, "Account is inactive");
  }
  if (!user.isEmailVerified) {
    throw new AppError(403, "Email verification is required");
  }

  return user;
}
```

Add `login` to the service export.

- [ ] **Step 6: Add session controllers and routes**

Add these imports to `controllers/authController.js`:

```js
const { signAuthToken } = require("../services/jwtService");
const { setAuthCookie, clearAuthCookie } = require("../utils/authCookie");
```

Add:

```js
async function login(req, res) {
  const user = await authService.login(req.validated);
  setAuthCookie(res, signAuthToken(user));
  res.status(200).json({ message: "Login successful", user: toSafeUser(user) });
}

function logout(req, res) {
  clearAuthCookie(res);
  res.status(200).json({ message: "Logout successful" });
}

function me(req, res) {
  res.status(200).json({ user: toSafeUser(req.user) });
}
```

Add `login`, `logout`, and `me` to the controller export.

Add this import to `routes/authRoutes.js`:

```js
const authenticate = require("../middleware/authenticate");
```

Add `loginValidation` to its validator import and add these routes:

```js
router.post(
  "/login",
  rateLimiters.login,
  rejectUnknownFields(["identifier", "password"]),
  loginValidation,
  validateRequest,
  asyncHandler(authController.login),
);

router.post("/logout", authController.logout);
router.get("/me", asyncHandler(authenticate), authController.me);
```

- [ ] **Step 7: Run focused and complete tests**

Run:

```powershell
npm test -- .\tests\auth\session.test.js
npm test
```

Expected: all session tests and the full suite pass.

- [ ] **Step 8: Commit cookie authentication**

```powershell
git add services/jwtService.js utils/authCookie.js middleware/authenticate.js middleware/authorize.js validators/authValidators.js services/authService.js controllers/authController.js routes/authRoutes.js tests/auth/session.test.js
git commit -m "feat: add cookie login and protected user session"
```

---

### Task 9: Neutral Forgot Password and Single-Use Reset

**Files:**
- Create: `server/tests/auth/password-reset.test.js`
- Modify: `server/validators/authValidators.js`
- Modify: `server/services/authService.js`
- Modify: `server/controllers/authController.js`
- Modify: `server/routes/authRoutes.js`

**Interfaces:**
- Consumes: reset token lifecycle, password hashing, email service, JWT versioning, and cookie clearing.
- Produces: `forgotPassword(email)`; `resetPassword({ token, newPassword })`; `POST /api/auth/forgot-password`; `POST /api/auth/reset-password`.

- [ ] **Step 1: Write failing forgot/reset API tests**

Create `tests/auth/password-reset.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../../app");
const AuthToken = require("../../models/AuthToken");
const User = require("../../models/User");
const emailService = require("../../services/emailService");
const { comparePassword, hashPassword } = require("../../services/passwordService");
const { hashToken, TOKEN_TYPES } = require("../../services/tokenService");
const {
  connectTestDb,
  clearTestDb,
  disconnectTestDb,
} = require("../helpers/testDb");

let sentEmails;

function resetTokenFromEmail(message) {
  const match = message.text.match(/token=([a-f0-9]{64})/);
  assert.ok(match);
  return match[1];
}

async function createVerifiedUser() {
  return User.create({
    username: "durai_01",
    email: "durai@example.com",
    mobile: "9876543210",
    address: "Chennai",
    passwordHash: await hashPassword("StrongPass1"),
    role: "customer",
    isEmailVerified: true,
  });
}

test.before(connectTestDb);
test.beforeEach(async () => {
  await clearTestDb();
  sentEmails = [];
  emailService.setTransporterForTests({
    async sendMail(message) {
      sentEmails.push(message);
      return { messageId: "reset-test" };
    },
  });
});
test.afterEach(emailService.resetTransporterForTests);
test.after(disconnectTestDb);

test("forgot-password response does not reveal whether an account exists", async () => {
  await createVerifiedUser();
  const known = await request(app)
    .post("/api/auth/forgot-password")
    .set("Origin", "http://localhost:5173")
    .send({ email: "durai@example.com" });
  const unknown = await request(app)
    .post("/api/auth/forgot-password")
    .set("Origin", "http://localhost:5173")
    .send({ email: "unknown@example.com" });

  assert.equal(known.status, 200);
  assert.deepEqual(known.body, unknown.body);
  assert.equal(sentEmails.length, 1);
});

test("reset token works once, changes the hash, and invalidates the old JWT", async () => {
  const user = await createVerifiedUser();
  const login = await request(app)
    .post("/api/auth/login")
    .set("Origin", "http://localhost:5173")
    .send({ identifier: user.email, password: "StrongPass1" });

  await request(app)
    .post("/api/auth/forgot-password")
    .set("Origin", "http://localhost:5173")
    .send({ email: user.email });
  const token = resetTokenFromEmail(sentEmails[0]);

  const reset = await request(app)
    .post("/api/auth/reset-password")
    .set("Origin", "http://localhost:5173")
    .send({ token, newPassword: "NewStrong2" });
  const reused = await request(app)
    .post("/api/auth/reset-password")
    .set("Origin", "http://localhost:5173")
    .send({ token, newPassword: "AnotherStrong3" });
  const stale = await request(app)
    .get("/api/auth/me")
    .set("Cookie", login.headers["set-cookie"][0]);

  const updated = await User.findById(user._id).select("+passwordHash +tokenVersion");
  assert.equal(reset.status, 200);
  assert.match(reset.headers["set-cookie"][0], /^vsb_auth=;/);
  assert.equal(reused.status, 400);
  assert.equal(stale.status, 401);
  assert.equal(updated.tokenVersion, 1);
  assert.equal(await comparePassword("NewStrong2", updated.passwordHash), true);
});

test("forgot-password remains neutral when injected email delivery fails", async () => {
  await createVerifiedUser();
  emailService.setTransporterForTests({
    async sendMail() {
      throw new Error("test delivery failure");
    },
  });

  const response = await request(app)
    .post("/api/auth/forgot-password")
    .set("Origin", "http://localhost:5173")
    .send({ email: "durai@example.com" });

  assert.equal(response.status, 200);
  assert.equal(JSON.stringify(response.body).includes("failure"), false);
});

test("an expired reset token returns the same safe link error", async () => {
  const user = await createVerifiedUser();
  const rawToken = "c".repeat(64);
  await AuthToken.create({
    userId: user._id,
    type: TOKEN_TYPES.PASSWORD_RESET,
    tokenHash: hashToken(rawToken),
    expiresAt: new Date(Date.now() - 1000),
  });

  const response = await request(app)
    .post("/api/auth/reset-password")
    .set("Origin", "http://localhost:5173")
    .send({ token: rawToken, newPassword: "NewStrong2" });

  assert.equal(response.status, 400);
  assert.equal(response.body.message, "This link is invalid or expired");
});
```

- [ ] **Step 2: Run the focused test and verify the expected failure**

Run:

```powershell
npm test -- .\tests\auth\password-reset.test.js
```

Expected: FAIL with `404` responses because forgot/reset routes are absent.

- [ ] **Step 3: Add reset-password validation**

Add to `validators/authValidators.js`:

```js
const resetPasswordValidation = [
  ...tokenValidation,
  strongPassword("newPassword"),
];
```

Add `resetPasswordValidation` to the validator module export.

- [ ] **Step 4: Implement forgot and reset business logic**

Add `removeAuthTokens` to the token-service import in `services/authService.js`, then add:

```js
const FORGOT_MESSAGE =
  "If an eligible account exists, a password reset email has been sent.";

async function forgotPassword(email) {
  const user = await User.findOne({ email, isActive: true });
  if (!user) {
    return { message: FORGOT_MESSAGE };
  }

  const token = await issueAuthToken(user._id, TOKEN_TYPES.PASSWORD_RESET);
  try {
    await emailService.sendPasswordResetEmail({ to: user.email, token });
  } catch {
    return { message: FORGOT_MESSAGE };
  }

  return { message: FORGOT_MESSAGE };
}

async function resetPassword({ token, newPassword }) {
  const record = await consumeAuthToken(token, TOKEN_TYPES.PASSWORD_RESET);
  if (!record) {
    throw new AppError(400, "This link is invalid or expired");
  }

  const passwordHash = await hashPassword(newPassword);
  const user = await User.findByIdAndUpdate(
    record.userId,
    {
      $set: { passwordHash },
      $inc: { tokenVersion: 1 },
    },
    { new: true },
  );
  if (!user) {
    throw new AppError(400, "This link is invalid or expired");
  }

  await removeAuthTokens(user._id, TOKEN_TYPES.PASSWORD_RESET);
  return user;
}
```

Add `forgotPassword` and `resetPassword` to the service export.

- [ ] **Step 5: Add forgot/reset controllers and routes**

Add to `controllers/authController.js`:

```js
async function forgotPassword(req, res) {
  const result = await authService.forgotPassword(req.validated.email);
  res.status(200).json(result);
}

async function resetPassword(req, res) {
  await authService.resetPassword(req.validated);
  clearAuthCookie(res);
  res.status(200).json({ message: "Password reset successful. Log in again." });
}
```

Add both functions to the controller export.

Add `resetPasswordValidation` to the validator import in `routes/authRoutes.js`, then add:

```js
router.post(
  "/forgot-password",
  rateLimiters.forgotPassword,
  rejectUnknownFields(["email"]),
  emailValidation,
  validateRequest,
  asyncHandler(authController.forgotPassword),
);

router.post(
  "/reset-password",
  rejectUnknownFields(["token", "newPassword"]),
  resetPasswordValidation,
  validateRequest,
  asyncHandler(authController.resetPassword),
);
```

- [ ] **Step 6: Run focused and complete tests**

Run:

```powershell
npm test -- .\tests\auth\password-reset.test.js
npm test
```

Expected: forgot/reset tests and the full suite pass.

- [ ] **Step 7: Commit password recovery**

```powershell
git add validators/authValidators.js services/authService.js controllers/authController.js routes/authRoutes.js tests/auth/password-reset.test.js
git commit -m "feat: add neutral single-use password recovery"
```

---

### Task 10: Authenticated Password Change

**Files:**
- Create: `server/tests/auth/change-password.test.js`
- Modify: `server/validators/authValidators.js`
- Modify: `server/services/authService.js`
- Modify: `server/controllers/authController.js`
- Modify: `server/routes/authRoutes.js`

**Interfaces:**
- Consumes: `authenticate`, bcrypt comparison/hashing, `tokenVersion`, and cookie clearing.
- Produces: `changePassword({ userId, currentPassword, newPassword })`; `PATCH /api/auth/change-password`.

- [ ] **Step 1: Write failing authenticated password-change tests**

Create `tests/auth/change-password.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../../app");
const User = require("../../models/User");
const { comparePassword, hashPassword } = require("../../services/passwordService");
const {
  connectTestDb,
  clearTestDb,
  disconnectTestDb,
} = require("../helpers/testDb");

async function createAndLogin() {
  const user = await User.create({
    username: "durai_01",
    email: "durai@example.com",
    mobile: "9876543210",
    address: "Chennai",
    passwordHash: await hashPassword("StrongPass1"),
    role: "customer",
    isEmailVerified: true,
  });
  const login = await request(app)
    .post("/api/auth/login")
    .set("Origin", "http://localhost:5173")
    .send({ identifier: user.email, password: "StrongPass1" });
  return { user, cookie: login.headers["set-cookie"][0] };
}

test.before(connectTestDb);
test.beforeEach(clearTestDb);
test.after(disconnectTestDb);

test("change-password replaces the hash, increments version, and clears the cookie", async () => {
  const { user, cookie } = await createAndLogin();
  const response = await request(app)
    .patch("/api/auth/change-password")
    .set("Origin", "http://localhost:5173")
    .set("Cookie", cookie)
    .send({ currentPassword: "StrongPass1", newPassword: "NewStrong2" });

  const stale = await request(app).get("/api/auth/me").set("Cookie", cookie);
  const updated = await User.findById(user._id).select("+passwordHash +tokenVersion");

  assert.equal(response.status, 200);
  assert.match(response.headers["set-cookie"][0], /^vsb_auth=;/);
  assert.equal(stale.status, 401);
  assert.equal(updated.tokenVersion, 1);
  assert.equal(await comparePassword("NewStrong2", updated.passwordHash), true);
});

test("change-password rejects an incorrect current password without changing data", async () => {
  const { user, cookie } = await createAndLogin();
  const response = await request(app)
    .patch("/api/auth/change-password")
    .set("Origin", "http://localhost:5173")
    .set("Cookie", cookie)
    .send({ currentPassword: "WrongPass1", newPassword: "NewStrong2" });

  const unchanged = await User.findById(user._id).select("+passwordHash +tokenVersion");
  assert.equal(response.status, 401);
  assert.equal(response.body.message, "Current password is incorrect");
  assert.equal(unchanged.tokenVersion, 0);
  assert.equal(await comparePassword("StrongPass1", unchanged.passwordHash), true);
});
```

- [ ] **Step 2: Run the focused test and verify the expected failure**

Run:

```powershell
npm test -- .\tests\auth\change-password.test.js
```

Expected: FAIL with `404` because the route does not exist.

- [ ] **Step 3: Add change-password validation**

Add to `validators/authValidators.js`:

```js
const changePasswordValidation = [
  body("currentPassword")
    .isString()
    .withMessage("Current password must be text")
    .bail()
    .notEmpty()
    .withMessage("Current password is required"),
  strongPassword("newPassword").custom((value, { req }) => {
    if (value === req.body.currentPassword) {
      throw new Error("New password must be different from the current password");
    }
    return true;
  }),
];
```

Add `changePasswordValidation` to the validator module export.

- [ ] **Step 4: Implement password-change business logic**

Add to `services/authService.js`:

```js
async function changePassword({ userId, currentPassword, newPassword }) {
  const user = await User.findById(userId).select("+passwordHash +tokenVersion");
  if (!user) {
    throw new AppError(401, "Authentication required");
  }
  if (!(await comparePassword(currentPassword, user.passwordHash))) {
    throw new AppError(401, "Current password is incorrect");
  }

  user.passwordHash = await hashPassword(newPassword);
  user.tokenVersion += 1;
  await user.save();
  return user;
}
```

Add `changePassword` to the service export.

- [ ] **Step 5: Add the controller and protected route**

Add to `controllers/authController.js`:

```js
async function changePassword(req, res) {
  await authService.changePassword({
    userId: req.user._id,
    currentPassword: req.validated.currentPassword,
    newPassword: req.validated.newPassword,
  });
  clearAuthCookie(res);
  res.status(200).json({ message: "Password changed successfully. Log in again." });
}
```

Add `changePassword` to the controller export.

Add `changePasswordValidation` to the validator import in `routes/authRoutes.js`, then add:

```js
router.patch(
  "/change-password",
  asyncHandler(authenticate),
  rejectUnknownFields(["currentPassword", "newPassword"]),
  changePasswordValidation,
  validateRequest,
  asyncHandler(authController.changePassword),
);
```

- [ ] **Step 6: Run focused and complete tests**

Run:

```powershell
npm test -- .\tests\auth\change-password.test.js
npm test
```

Expected: both change-password tests and the full suite pass.

- [ ] **Step 7: Commit authenticated password change**

```powershell
git add validators/authValidators.js services/authService.js controllers/authController.js routes/authRoutes.js tests/auth/change-password.test.js
git commit -m "feat: add authenticated password change"
```

---

### Task 11: Administrator Invitation Creation and Acceptance

**Files:**
- Create: `server/models/AdminInvitation.js`
- Create: `server/controllers/adminController.js`
- Create: `server/routes/adminRoutes.js`
- Create: `server/tests/auth/admin-invitation.test.js`
- Modify: `server/validators/authValidators.js`
- Modify: `server/services/authService.js`
- Modify: `server/controllers/authController.js`
- Modify: `server/routes/authRoutes.js`
- Modify: `server/app.js`

**Interfaces:**
- Consumes: current database role from `authenticate`, `authorize("admin")`, SHA-256 token helpers, user/password/email services, and `rateLimiters.adminInvitation`.
- Produces: `AdminInvitation`; `createAdminInvitation({ email, invitedBy })`; `acceptAdminInvitation(input)`; `POST /api/admin/invitations`; `POST /api/auth/admin-invitations/accept`.

- [ ] **Step 1: Write failing administrator-invitation tests**

Create `tests/auth/admin-invitation.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../../app");
const AdminInvitation = require("../../models/AdminInvitation");
const User = require("../../models/User");
const emailService = require("../../services/emailService");
const { hashPassword } = require("../../services/passwordService");
const { hashToken } = require("../../services/tokenService");
const {
  connectTestDb,
  clearTestDb,
  disconnectTestDb,
} = require("../helpers/testDb");

let sentEmails;

async function createUser({ role, email, username }) {
  return User.create({
    username,
    email,
    mobile: role === "customer" ? "9876543210" : undefined,
    address: role === "customer" ? "Chennai" : undefined,
    passwordHash: await hashPassword("StrongPass1"),
    role,
    isEmailVerified: true,
    isActive: true,
  });
}

async function login(user) {
  const response = await request(app)
    .post("/api/auth/login")
    .set("Origin", "http://localhost:5173")
    .send({ identifier: user.email, password: "StrongPass1" });
  return response.headers["set-cookie"][0];
}

test.before(connectTestDb);
test.beforeEach(async () => {
  await clearTestDb();
  sentEmails = [];
  emailService.setTransporterForTests({
    async sendMail(message) {
      sentEmails.push(message);
      return { messageId: "admin-invitation-test" };
    },
  });
});
test.afterEach(emailService.resetTransporterForTests);
test.after(disconnectTestDb);

test("customer cannot create an administrator invitation", async () => {
  const customer = await createUser({
    role: "customer",
    email: "customer@example.com",
    username: "customer_01",
  });
  const response = await request(app)
    .post("/api/admin/invitations")
    .set("Origin", "http://localhost:5173")
    .set("Cookie", await login(customer))
    .send({ email: "invited@example.com" });

  assert.equal(response.status, 403);
});

test("administrator creates a bound invitation that can be accepted once", async () => {
  const admin = await createUser({
    role: "admin",
    email: "admin@example.com",
    username: "admin_01",
  });
  const adminCookie = await login(admin);
  const created = await request(app)
    .post("/api/admin/invitations")
    .set("Origin", "http://localhost:5173")
    .set("Cookie", adminCookie)
    .send({ email: "invited@example.com" });

  assert.equal(created.status, 201);
  assert.match(created.body.invitationLink, /\/admin\/accept-invitation\?/);
  const url = new URL(created.body.invitationLink);
  const token = url.searchParams.get("token");

  const wrongEmail = await request(app)
    .post("/api/auth/admin-invitations/accept")
    .set("Origin", "http://localhost:5173")
    .send({
      token,
      email: "wrong@example.com",
      username: "new_admin",
      password: "AdminStrong2",
    });
  assert.equal(wrongEmail.status, 400);

  const accepted = await request(app)
    .post("/api/auth/admin-invitations/accept")
    .set("Origin", "http://localhost:5173")
    .send({
      token,
      email: "invited@example.com",
      username: "new_admin",
      password: "AdminStrong2",
    });
  const reused = await request(app)
    .post("/api/auth/admin-invitations/accept")
    .set("Origin", "http://localhost:5173")
    .send({
      token,
      email: "invited@example.com",
      username: "another_admin",
      password: "AdminStrong3",
    });

  assert.equal(accepted.status, 201);
  assert.equal(accepted.body.user.role, "admin");
  assert.equal(accepted.body.user.isEmailVerified, false);
  assert.equal(accepted.body.emailSent, true);
  assert.equal(reused.status, 400);
  assert.equal(sentEmails.length, 1);
});

test("old admin cookie loses access after the database role changes", async () => {
  const admin = await createUser({
    role: "admin",
    email: "admin@example.com",
    username: "admin_01",
  });
  const cookie = await login(admin);
  await User.updateOne({ _id: admin._id }, { role: "customer", mobile: "9876543210", address: "Chennai" });

  const response = await request(app)
    .post("/api/admin/invitations")
    .set("Origin", "http://localhost:5173")
    .set("Cookie", cookie)
    .send({ email: "invited@example.com" });

  assert.equal(response.status, 403);
});

test("a new invitation replaces the older unused link for the same email", async () => {
  const admin = await createUser({
    role: "admin",
    email: "admin@example.com",
    username: "admin_01",
  });
  const cookie = await login(admin);
  const requestInvitation = () =>
    request(app)
      .post("/api/admin/invitations")
      .set("Origin", "http://localhost:5173")
      .set("Cookie", cookie)
      .send({ email: "invited@example.com" });

  const first = await requestInvitation();
  const second = await requestInvitation();
  const firstToken = new URL(first.body.invitationLink).searchParams.get("token");
  const rejectedOldLink = await request(app)
    .post("/api/auth/admin-invitations/accept")
    .set("Origin", "http://localhost:5173")
    .send({
      token: firstToken,
      email: "invited@example.com",
      username: "new_admin",
      password: "AdminStrong2",
    });

  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.notEqual(first.body.invitationLink, second.body.invitationLink);
  assert.equal(rejectedOldLink.status, 400);
  assert.equal(
    await AdminInvitation.countDocuments({ invitedEmail: "invited@example.com", usedAt: null }),
    1,
  );
});

test("an expired administrator invitation returns the safe link error", async () => {
  const admin = await createUser({
    role: "admin",
    email: "admin@example.com",
    username: "admin_01",
  });
  const rawToken = "d".repeat(64);
  await AdminInvitation.create({
    invitedEmail: "expired@example.com",
    tokenHash: hashToken(rawToken),
    invitedBy: admin._id,
    expiresAt: new Date(Date.now() - 1000),
  });

  const response = await request(app)
    .post("/api/auth/admin-invitations/accept")
    .set("Origin", "http://localhost:5173")
    .send({
      token: rawToken,
      email: "expired@example.com",
      username: "expired_admin",
      password: "AdminStrong2",
    });

  assert.equal(response.status, 400);
  assert.equal(response.body.message, "This link is invalid or expired");
});

test("administrator invitation refuses an existing account email", async () => {
  const admin = await createUser({
    role: "admin",
    email: "admin@example.com",
    username: "admin_01",
  });
  await createUser({
    role: "customer",
    email: "existing@example.com",
    username: "existing_01",
  });

  const response = await request(app)
    .post("/api/admin/invitations")
    .set("Origin", "http://localhost:5173")
    .set("Cookie", await login(admin))
    .send({ email: "existing@example.com" });

  assert.equal(response.status, 409);
  assert.equal(response.body.message, "An account already uses this email");
});
```

- [ ] **Step 2: Run the focused test and verify the expected failure**

Run:

```powershell
npm test -- .\tests\auth\admin-invitation.test.js
```

Expected: FAIL with `404` because administrator invitation routes are absent.

- [ ] **Step 3: Create the single-use invitation schema**

Create `models/AdminInvitation.js`:

```js
const mongoose = require("mongoose");

const adminInvitationSchema = new mongoose.Schema(
  {
    invitedEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    tokenHash: {
      type: String,
      required: true,
      unique: true,
    },
    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 },
    },
    usedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

adminInvitationSchema.index({ invitedEmail: 1, usedAt: 1 });

module.exports = mongoose.model("AdminInvitation", adminInvitationSchema);
```

- [ ] **Step 4: Add invitation request validation**

Add to `validators/authValidators.js`:

```js
const adminInvitationCreateValidation = [normalizedEmail()];

const adminInvitationAcceptValidation = [
  ...tokenValidation,
  normalizedEmail(),
  body("username")
    .isString()
    .withMessage("Username must be text")
    .bail()
    .trim()
    .toLowerCase()
    .isLength({ min: 3, max: 30 })
    .withMessage("Username must contain 3 to 30 characters")
    .matches(/^[a-z0-9_]+$/)
    .withMessage("Username may contain letters, numbers, and underscore only"),
  strongPassword("password"),
];
```

Add both arrays to the validator module export.

- [ ] **Step 5: Implement invitation creation and atomic acceptance**

Add these imports to `services/authService.js`:

```js
const AdminInvitation = require("../models/AdminInvitation");
const { readConfig } = require("../config/env");
```

Add `generateRawToken` and `hashToken` to its token-service import, then add:

```js
async function createAdminInvitation({ email, invitedBy }) {
  if (await User.exists({ email })) {
    throw new AppError(409, "An account already uses this email");
  }

  const rawToken = generateRawToken();
  await AdminInvitation.deleteMany({ invitedEmail: email, usedAt: null });
  const invitation = await AdminInvitation.create({
    invitedEmail: email,
    tokenHash: hashToken(rawToken),
    invitedBy,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
  const params = new URLSearchParams({ token: rawToken, email });
  const invitationLink = `${readConfig().clientUrl}/admin/accept-invitation?${params}`;

  return { invitation, invitationLink };
}

async function acceptAdminInvitation(input) {
  if (await User.exists({ email: input.email })) {
    throw new AppError(409, "An account already uses this email");
  }

  const usedAt = new Date();
  const invitation = await AdminInvitation.findOneAndUpdate(
    {
      tokenHash: hashToken(input.token),
      invitedEmail: input.email,
      usedAt: null,
      expiresAt: { $gt: usedAt },
    },
    { $set: { usedAt } },
    { new: true },
  );
  if (!invitation) {
    throw new AppError(400, "This link is invalid or expired");
  }

  let user;
  try {
    user = await User.create({
      username: input.username,
      email: input.email,
      passwordHash: await hashPassword(input.password),
      role: "admin",
      isEmailVerified: false,
      isActive: true,
    });
  } catch (error) {
    await AdminInvitation.updateOne(
      { _id: invitation._id, usedAt },
      { $set: { usedAt: null } },
    );
    throw error;
  }

  const verificationToken = await issueAuthToken(
    user._id,
    TOKEN_TYPES.EMAIL_VERIFICATION,
  );
  let emailSent = true;
  try {
    await emailService.sendVerificationEmail({
      to: user.email,
      token: verificationToken,
    });
  } catch {
    emailSent = false;
  }

  return { user, emailSent };
}
```

Add `createAdminInvitation` and `acceptAdminInvitation` to the service export.

- [ ] **Step 6: Add controllers and routes**

Create `controllers/adminController.js`:

```js
const authService = require("../services/authService");

async function createInvitation(req, res) {
  const result = await authService.createAdminInvitation({
    email: req.validated.email,
    invitedBy: req.user._id,
  });
  res.status(201).json({
    message: "Administrator invitation created",
    invitedEmail: result.invitation.invitedEmail,
    expiresAt: result.invitation.expiresAt,
    invitationLink: result.invitationLink,
  });
}

module.exports = { createInvitation };
```

Create `routes/adminRoutes.js`:

```js
const express = require("express");

const adminController = require("../controllers/adminController");
const authenticate = require("../middleware/authenticate");
const authorize = require("../middleware/authorize");
const { rejectUnknownFields, validateRequest } = require("../middleware/validateRequest");
const asyncHandler = require("../utils/asyncHandler");
const { adminInvitationCreateValidation } = require("../validators/authValidators");

function createAdminRouter({ rateLimiters }) {
  const router = express.Router();

  router.post(
    "/invitations",
    asyncHandler(authenticate),
    authorize("admin"),
    rateLimiters.adminInvitation,
    rejectUnknownFields(["email"]),
    adminInvitationCreateValidation,
    validateRequest,
    asyncHandler(adminController.createInvitation),
  );

  return router;
}

module.exports = createAdminRouter;
```

Add to `controllers/authController.js`:

```js
async function acceptAdminInvitation(req, res) {
  const result = await authService.acceptAdminInvitation(req.validated);
  res.status(201).json({
    message: result.emailSent
      ? "Administrator account created. Check the invited email to verify it."
      : "Administrator account created, but verification email delivery failed. Use resend verification.",
    emailSent: result.emailSent,
    user: toSafeUser(result.user),
  });
}
```

Add `acceptAdminInvitation` to the controller export.

Add `adminInvitationAcceptValidation` to the validator import in `routes/authRoutes.js`, then add:

```js
router.post(
  "/admin-invitations/accept",
  rejectUnknownFields(["token", "email", "username", "password"]),
  adminInvitationAcceptValidation,
  validateRequest,
  asyncHandler(authController.acceptAdminInvitation),
);
```

Add this import to `app.js`:

```js
const createAdminRouter = require("./routes/adminRoutes");
```

Mount it after the authentication router and before `notFound`:

```js
app.use("/api/admin", createAdminRouter({ rateLimiters }));
```

- [ ] **Step 7: Run focused and complete tests**

Run:

```powershell
npm test -- .\tests\auth\admin-invitation.test.js
npm test
```

Expected: customer denial, single-use acceptance, email binding, database-role refresh, existing-user conflict, and the full suite all pass.

- [ ] **Step 8: Commit administrator invitations**

```powershell
git add models/AdminInvitation.js controllers/adminController.js routes/adminRoutes.js validators/authValidators.js services/authService.js controllers/authController.js routes/authRoutes.js app.js tests/auth/admin-invitation.test.js
git commit -m "feat: add administrator invitation workflow"
```

---

### Task 12: Safe First-Administrator Compass Document

**Files:**
- Create: `server/scripts/create-first-admin-document.js`
- Create: `server/tests/scripts/create-first-admin-document.test.js`

**Interfaces:**
- Consumes: `hashPassword()` and the approved password rules.
- Produces: `buildFirstAdminDocument(input)` returning a complete insertable document containing a bcrypt hash but never a normal password; command-line JSON for MongoDB Compass.

- [ ] **Step 1: Write the failing bootstrap-document test**

Create `tests/scripts/create-first-admin-document.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildFirstAdminDocument,
  serializeCompassDocument,
} = require("../../scripts/create-first-admin-document");
const { comparePassword } = require("../../services/passwordService");

test("first-admin document contains a bcrypt hash and verified active defaults", async () => {
  const document = await buildFirstAdminDocument({
    username: "first_admin",
    email: "admin@example.com",
    password: "AdminStrong1",
    now: new Date("2026-08-26T00:00:00.000Z"),
  });

  assert.equal(document.role, "admin");
  assert.equal(document.isEmailVerified, true);
  assert.equal(document.isActive, true);
  assert.equal(document.tokenVersion, 0);
  assert.equal(Object.hasOwn(document, "password"), false);
  assert.ok(document.passwordHash.startsWith("$2"));
  assert.equal(await comparePassword("AdminStrong1", document.passwordHash), true);

  const compassJson = JSON.parse(serializeCompassDocument(document));
  assert.deepEqual(compassJson.createdAt, { $date: "2026-08-26T00:00:00.000Z" });
  assert.deepEqual(compassJson.updatedAt, { $date: "2026-08-26T00:00:00.000Z" });
});

test("first-admin generator rejects weak passwords", async () => {
  await assert.rejects(
    buildFirstAdminDocument({
      username: "first_admin",
      email: "admin@example.com",
      password: "weak",
    }),
    /8 to 72 characters/,
  );
});
```

- [ ] **Step 2: Run the focused test and verify the expected failure**

Run:

```powershell
npm test -- .\tests\scripts\create-first-admin-document.test.js
```

Expected: FAIL because the script does not exist.

- [ ] **Step 3: Implement the safe document generator**

Create `scripts/create-first-admin-document.js`:

```js
const { hashPassword } = require("../services/passwordService");

function validateInput({ username, email, password }) {
  const normalizedUsername = String(username || "").trim().toLowerCase();
  const normalizedEmail = String(email || "").trim().toLowerCase();

  if (!/^[a-z0-9_]{3,30}$/.test(normalizedUsername)) {
    throw new Error("Username must contain 3 to 30 letters, numbers, or underscore characters");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new Error("Email must be valid");
  }
  if (typeof password !== "string" || password.length < 8 || password.length > 72) {
    throw new Error("Password must contain 8 to 72 characters");
  }
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
    throw new Error("Password must contain uppercase, lowercase, and number characters");
  }

  return { username: normalizedUsername, email: normalizedEmail };
}

async function buildFirstAdminDocument({ username, email, password, now = new Date() }) {
  const normalized = validateInput({ username, email, password });
  return {
    username: normalized.username,
    email: normalized.email,
    passwordHash: await hashPassword(password),
    role: "admin",
    isEmailVerified: true,
    isActive: true,
    tokenVersion: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function serializeCompassDocument(document) {
  return JSON.stringify(
    {
      ...document,
      createdAt: { $date: document.createdAt.toISOString() },
      updatedAt: { $date: document.updatedAt.toISOString() },
    },
    null,
    2,
  );
}

async function main() {
  const password = process.env.ADMIN_PASSWORD;
  delete process.env.ADMIN_PASSWORD;
  const document = await buildFirstAdminDocument({
    username: process.env.ADMIN_USERNAME,
    email: process.env.ADMIN_EMAIL,
    password,
  });
  process.stdout.write(`${serializeCompassDocument(document)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { buildFirstAdminDocument, serializeCompassDocument };
```

- [ ] **Step 4: Run focused and complete tests**

Run:

```powershell
npm test -- .\tests\scripts\create-first-admin-document.test.js
npm test
```

Expected: bootstrap tests and the full suite pass.

- [ ] **Step 5: Generate one complete document without putting the password in command history**

Run this as one PowerShell block:

```powershell
$adminUsername = Read-Host "First admin username"
$adminEmail = Read-Host "First admin email"
$securePassword = Read-Host "First admin password" -AsSecureString
$plainPassword = [System.Net.NetworkCredential]::new("", $securePassword).Password
$env:ADMIN_USERNAME = $adminUsername
$env:ADMIN_EMAIL = $adminEmail
$env:ADMIN_PASSWORD = $plainPassword
node .\scripts\create-first-admin-document.js
Remove-Item Env:ADMIN_USERNAME, Env:ADMIN_EMAIL, Env:ADMIN_PASSWORD -ErrorAction SilentlyContinue
$plainPassword = $null
$securePassword = $null
```

Expected: the terminal prints one JSON document. It includes `passwordHash` beginning with `$2`, and it does not include `password`.

- [ ] **Step 6: Insert the generated document in MongoDB Compass**

In Compass:

1. Open `vehicle_service_booking`.
2. Open the `users` collection. If it is not visible, run `npm start` once so Mongoose creates model indexes, then refresh Compass.
3. Select **Add Data → Insert Document**.
4. Remove the editor's sample object and paste the complete JSON printed by the script.
5. Select **Insert**.
6. Confirm the saved document has `role: "admin"`, `isEmailVerified: true`, `isActive: true`, `tokenVersion: 0`, and a bcrypt `passwordHash`.

- [ ] **Step 7: Commit the generator, never its generated output**

```powershell
git add scripts/create-first-admin-document.js tests/scripts/create-first-admin-document.test.js
git commit -m "feat: add safe first administrator bootstrap tool"
```

Do not save or commit the generated administrator document because it contains a usable password hash and personal email address.

---

### Task 13: End-to-End Acceptance, Gmail Check, and Handoff Documentation

**Files:**
- Create: `server/tests/auth/authentication-acceptance.test.js`
- Create: `server/docs/authentication-manual-checks.md`

**Interfaces:**
- Consumes: every authentication route, the isolated test database, fake email transport, local Gmail settings, and the first administrator.
- Produces: one automated customer journey, one manual Gmail/Compass/admin-invitation checklist, and final evidence for all acceptance criteria.

- [ ] **Step 1: Write the end-to-end customer acceptance test**

Create `tests/auth/authentication-acceptance.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../../app");
const emailService = require("../../services/emailService");
const {
  connectTestDb,
  clearTestDb,
  disconnectTestDb,
} = require("../helpers/testDb");

test.before(connectTestDb);
test.beforeEach(clearTestDb);
test.afterEach(emailService.resetTransporterForTests);
test.after(disconnectTestDb);

test("customer registers, verifies, logs in, reads profile, and logs out", async () => {
  const sent = [];
  emailService.setTransporterForTests({
    async sendMail(message) {
      sent.push(message);
      return { messageId: "acceptance-test" };
    },
  });

  const registration = await request(app)
    .post("/api/auth/register")
    .set("Origin", "http://localhost:5173")
    .send({
      username: "journey_user",
      email: "journey@example.com",
      mobile: "9876543210",
      address: "Chennai",
      password: "JourneyPass1",
    });
  assert.equal(registration.status, 201);

  const blockedLogin = await request(app)
    .post("/api/auth/login")
    .set("Origin", "http://localhost:5173")
    .send({ identifier: "journey@example.com", password: "JourneyPass1" });
  assert.equal(blockedLogin.status, 403);

  const verificationToken = sent[0].text.match(/token=([a-f0-9]{64})/)[1];
  const verification = await request(app)
    .post("/api/auth/verify-email")
    .set("Origin", "http://localhost:5173")
    .send({ token: verificationToken });
  assert.equal(verification.status, 200);

  const login = await request(app)
    .post("/api/auth/login")
    .set("Origin", "http://localhost:5173")
    .send({ identifier: "journey_user", password: "JourneyPass1" });
  assert.equal(login.status, 200);
  const cookie = login.headers["set-cookie"][0];

  const current = await request(app).get("/api/auth/me").set("Cookie", cookie);
  assert.equal(current.status, 200);
  assert.equal(current.body.user.email, "journey@example.com");

  const logout = await request(app)
    .post("/api/auth/logout")
    .set("Origin", "http://localhost:5173")
    .set("Cookie", cookie);
  assert.equal(logout.status, 200);
  assert.match(logout.headers["set-cookie"][0], /^vsb_auth=;/);
});
```

- [ ] **Step 2: Run the acceptance test and confirm it is a genuine new gate**

Run:

```powershell
npm test -- .\tests\auth\authentication-acceptance.test.js
```

Expected: PASS. This test uses multiple already-implemented interfaces; if it fails, correct the broken interface before continuing.

- [ ] **Step 3: Create the exact manual verification checklist**

Create `docs/authentication-manual-checks.md`:

````markdown
# Authentication Manual Checks

Run every command from `C:\Users\Durai\VehicleServiceBooking\server`.
Never paste `.env`, a Gmail App Password, a JWT cookie, a normal password, or a complete usable token into chat or Git.

## 1. Automated gate

```powershell
npm test
npm audit
```

Required: all tests pass and audit reports zero vulnerabilities.

## 2. Start the backend

```powershell
npm start
```

Required messages:

```text
Server is running on http://localhost:5000
```

In a second PowerShell terminal:

```powershell
Invoke-RestMethod http://localhost:5000/api/health
```

Required API message: `Vehicle Service Booking API is running`.

## 3. Real Gmail customer verification

Choose an email inbox you can open and a unique username:

```powershell
$customerEmail = Read-Host "Customer email"
$customerUsername = Read-Host "Unique customer username"
$secureCustomerPassword = Read-Host "Customer password" -AsSecureString
$customerPassword = [System.Net.NetworkCredential]::new("", $secureCustomerPassword).Password
$body = @{
  username = $customerUsername
  email = $customerEmail
  mobile = "9876543210"
  address = "Chennai"
  password = $customerPassword
} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://localhost:5000/api/auth/register -ContentType "application/json" -Headers @{ Origin = "http://localhost:5173" } -Body $body
```

Required: response status is 201, `emailSent` is true, and Gmail receives one verification message.

Because the React page is outside this backend scope, copy only the token value from the received link and enter it when PowerShell prompts:

```powershell
$verificationToken = Read-Host "Verification token from Gmail link"
$verifyBody = @{ token = $verificationToken } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://localhost:5000/api/auth/verify-email -ContentType "application/json" -Headers @{ Origin = "http://localhost:5173" } -Body $verifyBody
$verificationToken = $null
```

Required: `Email verified successfully. You can now log in.` A second use of the same link must fail.

## 4. Cookie login and protected profile

```powershell
$loginBody = @{ identifier = $customerEmail; password = $customerPassword } | ConvertTo-Json
$customerSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
Invoke-RestMethod -Method Post -Uri http://localhost:5000/api/auth/login -ContentType "application/json" -Headers @{ Origin = "http://localhost:5173" } -Body $loginBody -WebSession $customerSession
Invoke-RestMethod -Method Get -Uri http://localhost:5000/api/auth/me -WebSession $customerSession
```

Required: login JSON contains no token, and `/me` returns the safe customer profile.

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:5000/api/auth/logout -Headers @{ Origin = "http://localhost:5173" } -WebSession $customerSession
$customerPassword = $null
$secureCustomerPassword = $null
```

Required: logout succeeds and another `/me` call returns 401.

## 5. First administrator and invitation

Generate and insert the first administrator document using Task 12. Log in with that administrator through `/api/auth/login`, keeping its cookie in a separate `$adminSession` WebRequestSession.

```powershell
$adminEmail = Read-Host "First administrator email"
$secureAdminPassword = Read-Host "First administrator password" -AsSecureString
$adminPassword = [System.Net.NetworkCredential]::new("", $secureAdminPassword).Password
$adminLoginBody = @{ identifier = $adminEmail; password = $adminPassword } | ConvertTo-Json
$adminSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
Invoke-RestMethod -Method Post -Uri http://localhost:5000/api/auth/login -ContentType "application/json" -Headers @{ Origin = "http://localhost:5173" } -Body $adminLoginBody -WebSession $adminSession
$adminPassword = $null
$secureAdminPassword = $null

$inviteEmail = Read-Host "New administrator email"
$inviteBody = @{ email = $inviteEmail } | ConvertTo-Json
$invite = Invoke-RestMethod -Method Post -Uri http://localhost:5000/api/admin/invitations -ContentType "application/json" -Headers @{ Origin = "http://localhost:5173" } -Body $inviteBody -WebSession $adminSession
$invite.invitationLink
```

Required: only an authenticated administrator receives a 201 response and a 24-hour link.

Accept the invitation using the exact invited email:

```powershell
$inviteToken = [uri]::UnescapeDataString(((($invite.invitationLink -split 'token=')[1]) -split '&')[0])
$invitedUsername = Read-Host "New administrator username"
$secureInvitedPassword = Read-Host "New administrator password" -AsSecureString
$invitedPassword = [System.Net.NetworkCredential]::new("", $secureInvitedPassword).Password
$acceptBody = @{
  token = $inviteToken
  email = $inviteEmail
  username = $invitedUsername
  password = $invitedPassword
} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://localhost:5000/api/auth/admin-invitations/accept -ContentType "application/json" -Headers @{ Origin = "http://localhost:5173" } -Body $acceptBody
$inviteToken = $null
$invitedPassword = $null
$secureInvitedPassword = $null
```

Required: the created account has role `admin`, remains unverified, and Gmail receives a separate verification email. Before verification, `/api/auth/login` must return 403. Copy the Gmail verification token and verify it with the same `/api/auth/verify-email` PowerShell command from section 3. A second invitation acceptance and a second verification-token use must both fail.

## 6. Compass inspection

In `vehicle_service_booking`, inspect `users`, `authtokens`, and `admininvitations`.

Required:

- `users.passwordHash` contains bcrypt text beginning with `$2`, never the normal password.
- No collection contains a usable verification, reset, or invitation token.
- Used tokens cannot be reused even if TTL cleanup has not removed the document yet.
- No API response contains `passwordHash`, `tokenHash`, `tokenVersion`, Gmail credentials, or `JWT_SECRET`.
````

- [ ] **Step 4: Run the final automated and dependency gates**

Run:

```powershell
npm test
npm audit
npm ls bcryptjs cookie-parser cors dotenv express express-rate-limit express-validator helmet jsonwebtoken mongoose nodemailer supertest
git status --short
```

Expected:

- Every test reports `pass` and zero tests report `fail`.
- `npm audit` reports `found 0 vulnerabilities`.
- All listed packages resolve without `(empty)` or `invalid`.
- `.env` and `node_modules` are absent from `git status --short`.

- [ ] **Step 5: Run the manual Gmail, cookie, Compass, and administrator checks**

Follow `docs/authentication-manual-checks.md` from top to bottom. Record only pass/fail notes; do not record passwords, cookie values, tokens, or Gmail credentials.

Expected: all six manual sections pass.

- [ ] **Step 6: Commit the acceptance gate and documentation**

```powershell
git add tests/auth/authentication-acceptance.test.js docs/authentication-manual-checks.md
git commit -m "test: verify complete authentication workflow"
git status --short
```

Expected: commit succeeds and `git status --short` prints nothing.

---

## Completion Evidence

Authentication is complete only when the final handoff includes fresh, copied command summaries for:

1. `npm test` — total tests, pass count, fail count, and duration.
2. `npm audit` — zero known vulnerabilities.
3. `npm ls ...` — all required runtime and test packages installed correctly.
4. `Invoke-RestMethod http://localhost:5000/api/health` — expected health message.
5. Manual Gmail verification — one received email and one successful token use, with no token disclosed.
6. First administrator and invitation — role enforcement, single-use acceptance, and required invited-email verification.
7. `git status --short` — clean worktree with `.env` ignored.

Do not call the subsystem complete from screenshots alone; terminal and API evidence must match the checks above.
