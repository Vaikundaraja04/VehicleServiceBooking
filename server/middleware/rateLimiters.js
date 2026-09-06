const { ipKeyGenerator, rateLimit } = require("express-rate-limit");

const FIFTEEN_MINUTES = 15 * 60 * 1000;

function ipKey(req) {
  return ipKeyGenerator(req.ip);
}

function accountKey(field) {
  return (req) => {
    return String(req.body?.[field] || "unknown").trim().toLowerCase();
  };
}

function inviterKey(req) {
  return String(req.user?._id ?? req.user?.id ?? "unknown");
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

function makeAccountLimiters({ max, message, field }) {
  return [
    makeLimiter({ max, message, keyGenerator: ipKey }),
    makeLimiter({ max, message, keyGenerator: accountKey(field) }),
  ];
}

function makeInviterLimiters({ max, message }) {
  return [
    makeLimiter({ max, message, keyGenerator: ipKey }),
    makeLimiter({ max, message, keyGenerator: inviterKey }),
  ];
}

function createAuthRateLimiters(overrides = {}) {
  const testMaximum = process.env.NODE_ENV === "test" ? 10_000 : undefined;

  return {
    login: makeLimiter({
      max: overrides.loginMax ?? testMaximum ?? 5,
      message: "Too many login attempts. Try again later.",
      keyGenerator: ipKey,
    }),
    register: makeAccountLimiters({
      max: overrides.registerMax ?? testMaximum ?? 3,
      message: "Too many registration attempts. Try again later.",
      field: "email",
    }),
    resendVerification: makeAccountLimiters({
      max: overrides.resendMax ?? testMaximum ?? 3,
      message: "Too many verification requests. Try again later.",
      field: "email",
    }),
    forgotPassword: makeAccountLimiters({
      max: overrides.recoveryMax ?? testMaximum ?? 3,
      message: "Too many recovery requests. Try again later.",
      field: "email",
    }),
    adminInvitation: makeInviterLimiters({
      max: overrides.invitationMax ?? testMaximum ?? 3,
      message: "Too many invitation requests. Try again later.",
    }),
  };
}

module.exports = { createAuthRateLimiters };
