const { createEmailTransport } = require("../config/email");
const { readConfig } = require("../config/env");

let testTransporter = null;

function getSettings() {
  return readConfig();
}

function getTransporter() {
  return testTransporter || createEmailTransport(getSettings());
}

function setTransporterForTests(transporter) {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Email transporter injection is allowed only in tests");
  }
  testTransporter = transporter;
}

function resetTransporterForTests() {
  testTransporter = null;
}

async function sendVerificationEmail({ to, token }) {
   const config = getSettings();
   const link = `${config.clientUrl}/verify-email?token=${encodeURIComponent(token)}`;
   console.log(`Sending verification email to: ${to}`);
   return getTransporter().sendMail({
     from: config.emailFrom || config.gmailUser,
     to,
     subject: "Verify your Vehicle Service Booking email",
     text: `Open this link within 60 minutes to verify your email: ${link}`,
   });
 }

async function sendPasswordResetEmail({ to, token }) {
  const config = getSettings();
  const link = `${config.clientUrl}/reset-password?token=${encodeURIComponent(token)}`;
  return getTransporter().sendMail({
    from: config.emailFrom || config.gmailUser,
    to,
    subject: "Reset your Vehicle Service Booking password",
    text: `Open this link within 15 minutes to reset your password: ${link}`,
  });
}

module.exports = {
  sendVerificationEmail,
  sendPasswordResetEmail,
  setTransporterForTests,
  resetTransporterForTests,
};
