const User = require("../models/User");
const AdminInvitation = require("../models/AdminInvitation");
const { readConfig } = require("../config/env");
const AppError = require("../utils/AppError");
const emailService = require("./emailService");
const { comparePassword, hashPassword } = require("./passwordService");
const {
  claimAuthToken,
  completeAuthToken,
  generateRawToken,
  hashToken,
  issueAuthToken,
  releaseAuthToken,
  removeAuthTokens,
  TOKEN_TYPES,
} = require("./tokenService");

const RESEND_MESSAGE =
  "If the account can be verified, a new verification email has been sent.";
const FORGOT_MESSAGE =
  "If an eligible account exists, a password reset email has been sent.";
const DUMMY_PASSWORD_HASH =
  "$2b$12$xOPredCStgNxY4mH6VtNGex95U/Kusn7YbvE0J1NZpv2dGIn9YLPG";
const MAX_PERSIST_ATTEMPTS = 3;

async function settleTokenClaim(operation, claim) {
  try {
    await operation(claim);
  } catch {}
}

async function registerCustomer(input) {
  const conflict = await User.findOne({
    $or: [{ email: input.email }, { username: input.username }],
  }).lean();

  if (conflict) {
    const field = conflict.email === input.email ? "Email" : "Username";
    throw new AppError(409, `${field} already exists`);
  }

  const user = await User.create({
    username: input.username,
    email: input.email,
    mobile: input.mobile,
    address: input.address,
    passwordHash: await hashPassword(input.password),
    role: "customer",
    isEmailVerified: false,
    isActive: true,
  });

let emailSent = false;
   try {
     const token = await issueAuthToken(user._id, TOKEN_TYPES.EMAIL_VERIFICATION);
     await emailService.sendVerificationEmail({ to: user.email, token });
     emailSent = true;
   } catch (error) {
     console.error('Failed to send verification email:', error);
   }

  return { user, emailSent };
}

async function verifyEmail(token) {
  const claim = await claimAuthToken(token, TOKEN_TYPES.EMAIL_VERIFICATION);
  if (!claim) {
    throw new AppError(400, "This link is invalid or expired");
  }

  let user;
  try {
    user = await User.findByIdAndUpdate(
      claim.userId,
      { $set: { isEmailVerified: true } },
      { returnDocument: "after" },
    );
  } catch (error) {
    let currentUser;
    try {
      currentUser = await User.findById(claim.userId);
    } catch {
      throw error;
    }

    if (currentUser?.isEmailVerified) {
      await settleTokenClaim(completeAuthToken, claim);
      return currentUser;
    }

    await settleTokenClaim(releaseAuthToken, claim);
    throw error;
  }

  if (!user) {
    await settleTokenClaim(releaseAuthToken, claim);
    throw new AppError(400, "This link is invalid or expired");
  }

  await settleTokenClaim(completeAuthToken, claim);
  return user;
}

async function resendVerification(email) {
  const user = await User.findOne({ email });
  if (!user || user.isEmailVerified || !user.isActive) {
    return { message: RESEND_MESSAGE };
  }

  const token = await issueAuthToken(user._id, TOKEN_TYPES.EMAIL_VERIFICATION);
  try {
    await emailService.sendVerificationEmail({ to: user.email, token });
  } catch {
    throw new AppError(502, "Verification email could not be sent");
  }

  return { message: RESEND_MESSAGE };
}

async function forgotPassword(email) {
  const user = await User.findOne({ email, isActive: true }).select("+tokenVersion");
  if (!user) {
    return { message: FORGOT_MESSAGE };
  }

  try {
    const token = await issueAuthToken(user._id, TOKEN_TYPES.PASSWORD_RESET, {
      tokenVersion: user.tokenVersion,
    });
    await emailService.sendPasswordResetEmail({ to: user.email, token });
  } catch {}

  return { message: FORGOT_MESSAGE };
}

async function resetPassword({ token, newPassword }) {
  const claim = await claimAuthToken(token, TOKEN_TYPES.PASSWORD_RESET);
  if (!claim) {
    throw new AppError(400, "This link is invalid or expired");
  }

  if (!Number.isInteger(claim.tokenVersion) || claim.tokenVersion < 0) {
    await settleTokenClaim(completeAuthToken, claim);
    throw new AppError(400, "This link is invalid or expired");
  }

  let passwordHash;
  try {
    passwordHash = await hashPassword(newPassword);
  } catch (error) {
    await settleTokenClaim(releaseAuthToken, claim);
    throw error;
  }

  const nextTokenVersion = claim.tokenVersion + 1;
  let user;
  try {
    user = await User.findOneAndUpdate(
      { _id: claim.userId, tokenVersion: claim.tokenVersion },
      {
        $set: { passwordHash },
        $inc: { tokenVersion: 1 },
      },
      { returnDocument: "after" },
    );
  } catch (error) {
    let committedUser;
    try {
      committedUser = await User.findOne({
        _id: claim.userId,
        passwordHash,
        tokenVersion: nextTokenVersion,
      });
    } catch {
      throw error;
    }

    if (!committedUser) {
      await settleTokenClaim(releaseAuthToken, claim);
      throw error;
    }
    user = committedUser;
  }

  if (!user) {
    await settleTokenClaim(completeAuthToken, claim);
    throw new AppError(400, "This link is invalid or expired");
  }

  await settleTokenClaim(completeAuthToken, claim);
  await removeAuthTokens(user._id, TOKEN_TYPES.PASSWORD_RESET, {
    tokenVersion: { $lt: nextTokenVersion },
  }).catch(() => {});
  return user;
}

async function changePassword({ userId, currentPassword, newPassword }) {
  const user = await User.findById(userId).select("+passwordHash +tokenVersion");
  if (!user) {
    throw new AppError(401, "Authentication required");
  }
  if (!(await comparePassword(currentPassword, user.passwordHash))) {
    throw new AppError(401, "Current password is incorrect");
  }

  const passwordHash = await hashPassword(newPassword);
  const updatedUser = await User.findOneAndUpdate(
    {
      _id: userId,
      passwordHash: user.passwordHash,
      tokenVersion: user.tokenVersion,
    },
    {
      $set: { passwordHash },
      $inc: { tokenVersion: 1 },
    },
    { returnDocument: "after" },
  );
  if (!updatedUser) {
    throw new AppError(409, "Password changed in another request. Log in again.");
  }

  await removeAuthTokens(updatedUser._id, TOKEN_TYPES.PASSWORD_RESET, {
    tokenVersion: { $lt: user.tokenVersion + 1 },
  }).catch(() => {});
  return updatedUser;
}

async function createAdminInvitation({ email, invitedBy }) {
  if (await User.exists({ email })) {
    throw new AppError(409, "An account already uses this email");
  }

  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const filter = { invitedEmail: email, usedAt: null };
  const update = {
    $set: {
      tokenHash,
      invitedBy,
      expiresAt,
    },
  };

  let invitation = null;
  for (let attempt = 0; attempt < MAX_PERSIST_ATTEMPTS; attempt += 1) {
    try {
      invitation = await AdminInvitation.findOneAndUpdate(filter, update, {
        returnDocument: "after",
        upsert: true,
        setDefaultsOnInsert: true,
      });
    } catch (error) {
      if (error?.code !== 11000) {
        throw error;
      }
      invitation = await AdminInvitation.findOneAndUpdate(filter, update, {
        returnDocument: "after",
      });
    }

    if (invitation) {
      break;
    }
  }

  if (!invitation) {
    throw new Error("Administrator invitation could not be persisted");
  }

  const params = new URLSearchParams({ token: rawToken, email });
  const invitationLink = `${readConfig().clientUrl}/admin/accept-invitation?${params}`;

  return { invitation, invitationLink };
}

async function rollbackAdminAcceptance({ invitation, usedAt, user }) {
  if (user) {
    await removeAuthTokens(user._id, TOKEN_TYPES.EMAIL_VERIFICATION).catch(() => {});

    let deletion;
    try {
      deletion = await User.deleteOne({ _id: user._id });
    } catch {
      return;
    }
    if (deletion?.deletedCount !== 1) {
      return;
    }
  }

  await AdminInvitation.updateOne(
    { _id: invitation._id, usedAt },
    { $set: { usedAt: null } },
  ).catch(() => {});
}

async function acceptAdminInvitation(input) {
  const usedAt = new Date();
  const invitation = await AdminInvitation.findOneAndUpdate(
    {
      tokenHash: hashToken(input.token),
      invitedEmail: input.email,
      usedAt: null,
      expiresAt: { $gt: usedAt },
    },
    { $set: { usedAt } },
    { returnDocument: "after" },
  );
  if (!invitation) {
    throw new AppError(400, "This link is invalid or expired");
  }

  let user;
  let verificationToken;
  try {
    if (await User.exists({ email: input.email })) {
      throw new AppError(409, "An account already uses this email");
    }
    user = await User.create({
      username: input.username,
      email: input.email,
      passwordHash: await hashPassword(input.password),
      role: "admin",
      isEmailVerified: false,
      isActive: true,
    });
    verificationToken = await issueAuthToken(
      user._id,
      TOKEN_TYPES.EMAIL_VERIFICATION,
    );
  } catch (error) {
    await rollbackAdminAcceptance({ invitation, usedAt, user });
    throw error;
  }

  let emailSent = true;
  try {
    await emailService.sendVerificationEmail({
      to: user.email,
      token: verificationToken,
    });
  } catch {
    emailSent = false;
  }

  return { user, emailSent };
}

async function login(input) {
  const identifier = input.identifier.toLowerCase();
  const user = await User.findOne({
    $or: [{ email: identifier }, { username: identifier }],
  }).select("+passwordHash +tokenVersion");
  const passwordMatches = await comparePassword(
    input.password,
    user?.passwordHash || DUMMY_PASSWORD_HASH,
  );

  if (!user || !passwordMatches) {
    throw new AppError(401, "Incorrect email, username, or password");
  }
  if (!user.isActive) {
    throw new AppError(403, "Account is inactive");
  }
  if (!user.isEmailVerified) {
    throw new AppError(403, "Email verification is required");
  }

  return user;
}

module.exports = {
  registerCustomer,
  verifyEmail,
  resendVerification,
  forgotPassword,
  resetPassword,
  changePassword,
  createAdminInvitation,
  acceptAdminInvitation,
  login,
};
