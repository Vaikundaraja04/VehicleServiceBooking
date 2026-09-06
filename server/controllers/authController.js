const authService = require("../services/authService");
const { toSafeUser } = require("../utils/userResponse");
const { signAuthToken } = require("../services/jwtService");
const { setAuthCookie, clearAuthCookie } = require("../utils/authCookie");

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

async function verifyEmail(req, res) {
  await authService.verifyEmail(req.validated.token);
  res.status(200).json({ message: "Email verified successfully. You can now log in." });
}

async function resendVerification(req, res) {
  const result = await authService.resendVerification(req.validated.email);
  res.status(200).json(result);
}

async function forgotPassword(req, res) {
  const result = await authService.forgotPassword(req.validated.email);
  res.status(200).json(result);
}

async function resetPassword(req, res) {
  await authService.resetPassword(req.validated);
  clearAuthCookie(res);
  res.status(200).json({ message: "Password reset successful. Log in again." });
}

async function changePassword(req, res) {
  await authService.changePassword({
    userId: req.user._id,
    currentPassword: req.validated.currentPassword,
    newPassword: req.validated.newPassword,
  });
  clearAuthCookie(res);
  res.status(200).json({ message: "Password changed successfully. Log in again." });
}

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

module.exports = {
  register,
  verifyEmail,
  resendVerification,
  forgotPassword,
  resetPassword,
  changePassword,
  acceptAdminInvitation,
  login,
  logout,
  me,
};
