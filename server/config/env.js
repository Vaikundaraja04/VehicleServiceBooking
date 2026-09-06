const net = require("node:net");

const REQUIRED_NAMES = [
  "PORT",
  "MONGO_URI",
  "CLIENT_URL",
  "JWT_SECRET",
  "JWT_EXPIRES_IN",
  "GMAIL_USER",
  "GMAIL_APP_PASSWORD",
  "NODE_ENV",
];

const UNSAFE_JWT_SECRETS = new Set([
  "development-only-change-this-to-at-least-32-random-characters",
  "change-me",
  "replace-me",
  "your-jwt-secret",
]);

function isTrustedProxyEntry(value) {
  if (value === "loopback" || net.isIP(value)) {
    return true;
  }

  const separator = value.lastIndexOf("/");
  if (separator === -1) {
    return false;
  }

  const address = value.slice(0, separator);
  const prefix = Number(value.slice(separator + 1));
  const version = net.isIP(address);
  const maximumPrefix = version === 4 ? 32 : version === 6 ? 128 : 0;
  return Number.isInteger(prefix) && prefix > 0 && prefix <= maximumPrefix;
}

function readTrustedProxyIps(source) {
  const values = String(source.TRUSTED_PROXY_IPS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (values.some((value) => !isTrustedProxyEntry(value))) {
    throw new Error(
      "TRUSTED_PROXY_IPS must contain only comma-separated proxy IPs, CIDRs, or loopback",
    );
  }

  return values;
}

function readConfig(source = process.env) {
  const missing = REQUIRED_NAMES.filter((name) => !String(source[name] || "").trim());

  if (missing.length > 0) {
    throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  }

  const port = Number(source.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer from 1 to 65535");
  }

  const jwtSecret = String(source.JWT_SECRET);
  if (jwtSecret.length < 32) {
    throw new Error("JWT_SECRET must contain at least 32 characters");
  }

  if (UNSAFE_JWT_SECRETS.has(jwtSecret.toLowerCase())) {
    throw new Error("JWT_SECRET must be a private random value");
  }

  if (source.JWT_EXPIRES_IN !== "8h") {
    throw new Error("JWT_EXPIRES_IN must be 8h");
  }

  if (!new Set(["development", "test", "production"]).has(source.NODE_ENV)) {
    throw new Error("NODE_ENV must be development, test, or production");
  }

  const trustedProxyIps = readTrustedProxyIps(source);

  return Object.freeze({
    port,
    mongoUri: source.MONGO_URI,
    clientUrl: source.CLIENT_URL,
    jwtSecret,
    jwtExpiresIn: source.JWT_EXPIRES_IN,
    gmailUser: source.GMAIL_USER,
    gmailAppPassword: source.GMAIL_APP_PASSWORD,
    nodeEnv: source.NODE_ENV,
    isProduction: source.NODE_ENV === "production",
    trustedProxyIps: Object.freeze(trustedProxyIps),
  });
}

module.exports = { readConfig };
