const express = require("express");

const authController = require("../controllers/authController");
const authenticate = require("../middleware/authenticate");
const asyncHandler = require("../utils/asyncHandler");
const { rejectUnknownFields, validateRequest } = require("../middleware/validateRequest");
const {
  registerValidation,
  tokenValidation,
  emailValidation,
  resetPasswordValidation,
  changePasswordValidation,
  adminInvitationAcceptValidation,
  loginValidation,
} = require("../validators/authValidators");

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

  router.patch(
    "/change-password",
    asyncHandler(authenticate),
    rejectUnknownFields(["currentPassword", "newPassword"]),
    changePasswordValidation,
    validateRequest,
    asyncHandler(authController.changePassword),
  );

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

  router.post(
    "/admin-invitations/accept",
    rejectUnknownFields(["token", "email", "username", "password"]),
    adminInvitationAcceptValidation,
    validateRequest,
    asyncHandler(authController.acceptAdminInvitation),
  );

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

  return router;
}

module.exports = createAuthRouter;
