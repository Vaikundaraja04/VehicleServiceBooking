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
