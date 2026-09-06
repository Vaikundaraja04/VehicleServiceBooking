const { body } = require("express-validator");
const {
  hasValidPasswordLength,
  isBcryptSafePassword,
} = require("../services/passwordService");

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
    .custom(hasValidPasswordLength)
    .withMessage("Password must contain 8 to 72 characters")
    .custom(isBcryptSafePassword)
    .withMessage("Password must be at most 72 UTF-8 bytes long")
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

const tokenValidation = [
  body("token")
    .isString()
    .withMessage("Token must be text")
    .bail()
    .matches(/^[a-f0-9]{64}$/)
    .withMessage("Token must contain 64 lowercase hexadecimal characters"),
];

const emailValidation = [normalizedEmail()];

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

const resetPasswordValidation = [...tokenValidation, strongPassword("newPassword")];

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

const loginValidation = [
  body("identifier")
    .isString()
    .withMessage("Email or username must be text")
    .bail()
    .trim()
    .notEmpty()
    .withMessage("Email or username is required")
    .customSanitizer((value) => value.toLowerCase()),
  body("password")
    .isString()
    .withMessage("Password must be text")
    .bail()
    .notEmpty()
    .withMessage("Password is required"),
];

module.exports = {
  normalizedEmail,
  strongPassword,
  registerValidation,
  tokenValidation,
  emailValidation,
  adminInvitationCreateValidation,
  adminInvitationAcceptValidation,
  resetPasswordValidation,
  changePasswordValidation,
  loginValidation,
};
