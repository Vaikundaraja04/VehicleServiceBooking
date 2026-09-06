const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const dotenv = require("dotenv");

const { readConfig } = require("../../config/env");

const expectedPublicTemplate = [
  "PORT=5000",
  "MONGO_URI=mongodb://mongo:27017/vehicle_service_booking?replicaSet=rs0",
  "CLIENT_URL=http://localhost:5173",
  "JWT_SECRET=change-me",
  "JWT_EXPIRES_IN=8h",
  "GMAIL_USER=not-configured@example.invalid",
  "GMAIL_APP_PASSWORD=change-me",
  "NODE_ENV=development",
  "TRUSTED_PROXY_IPS=",
  "WORKSHOP_NAME=Vehicle Service Booking",
  "WORKSHOP_EMAIL=",
  "WORKSHOP_PHONE=",
  "WORKSHOP_ADDRESS=",
  "",
].join("\n");

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
  assert.deepEqual(result.trustedProxyIps, []);
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

test("readConfig accepts only an explicit proxy IP or CIDR allowlist", () => {
  const result = readConfig({
    ...validSource,
    TRUSTED_PROXY_IPS: "loopback, 10.20.0.0/16, 192.0.2.10",
  });

  assert.deepEqual(result.trustedProxyIps, [
    "loopback",
    "10.20.0.0/16",
    "192.0.2.10",
  ]);
  for (const unsafeValue of ["1", "true", "*", "10.0.0.0/99"]) {
    assert.throws(
      () => readConfig({ ...validSource, TRUSTED_PROXY_IPS: unsafeValue }),
      /TRUSTED_PROXY_IPS/,
    );
  }
});

test("readConfig rejects the formerly published JWT placeholder", () => {
  assert.throws(
    () =>
      readConfig({
        ...validSource,
        JWT_SECRET: "development-only-change-this-to-at-least-32-random-characters",
      }),
    /JWT_SECRET must be a private random value/,
  );
});

test("the public environment template fails closed until its JWT secret is replaced", () => {
  const source = readFileSync(
    path.join(__dirname, "../../.env.example"),
    "utf8",
  );
  const template = dotenv.parse(source);

  assert.equal(source, expectedPublicTemplate);
  assert.deepEqual(Object.keys(template), [
    "PORT",
    "MONGO_URI",
    "CLIENT_URL",
    "JWT_SECRET",
    "JWT_EXPIRES_IN",
    "GMAIL_USER",
    "GMAIL_APP_PASSWORD",
    "NODE_ENV",
    "TRUSTED_PROXY_IPS",
    "WORKSHOP_NAME",
    "WORKSHOP_EMAIL",
    "WORKSHOP_PHONE",
    "WORKSHOP_ADDRESS",
  ]);
  assert.throws(() => readConfig(template), /JWT_SECRET/);
});
