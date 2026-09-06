const nodemailer = require("nodemailer");

function createEmailTransport(config, options = {}) {
  if (config.emailProvider === "brevo") {
    return require("./brevo").createBrevoTransport(config, options);
  }
  if (!config.gmailUser || !config.gmailAppPassword) {
    throw new Error("Gmail email settings are not configured");
  }

  return nodemailer.createTransport({
    service: "gmail",
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
    auth: {
      user: config.gmailUser,
      pass: config.gmailAppPassword,
    },
  });
}

module.exports = { createEmailTransport };
