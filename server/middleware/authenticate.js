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
