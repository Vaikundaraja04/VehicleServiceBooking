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
