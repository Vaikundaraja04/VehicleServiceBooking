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
