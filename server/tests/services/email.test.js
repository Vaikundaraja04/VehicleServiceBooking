const test = require("node:test");
const assert = require("node:assert/strict");

const emailService = require("../../services/emailService");

test.afterEach(() => {
  emailService.resetTransporterForTests();
});

test("verification email uses the configured frontend URL and injected transport", async () => {
  const sent = [];
  emailService.setTransporterForTests({
    async sendMail(message) {
      sent.push(message);
      return { messageId: "test-message" };
    },
  });

  await emailService.sendVerificationEmail({
    to: "durai@example.com",
    token: "a".repeat(64),
  });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "durai@example.com");
  assert.match(
    sent[0].text,
    /http:\/\/localhost:5173\/verify-email\?token=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/,
  );
});

test("password reset email uses the reset path", async () => {
  const sent = [];
  emailService.setTransporterForTests({
    async sendMail(message) {
      sent.push(message);
      return { messageId: "test-message" };
    },
  });

  await emailService.sendPasswordResetEmail({
    to: "durai@example.com",
    token: "b".repeat(64),
  });

  assert.match(sent[0].text, /\/reset-password\?token=bbbb/);
});

test("email messages use the required subjects and expiry guidance", async () => {
  const sent = [];
  emailService.setTransporterForTests({
    async sendMail(message) {
      sent.push(message);
      return { messageId: "test-message" };
    },
  });

  await emailService.sendVerificationEmail({ to: "durai@example.com", token: "a b" });
  await emailService.sendPasswordResetEmail({ to: "durai@example.com", token: "a b" });

  assert.deepEqual(sent, [
    {
      from: "test@example.com",
      to: "durai@example.com",
      subject: "Verify your Vehicle Service Booking email",
      text: "Open this link within 60 minutes to verify your email: http://localhost:5173/verify-email?token=a%20b",
    },
    {
      from: "test@example.com",
      to: "durai@example.com",
      subject: "Reset your Vehicle Service Booking password",
      text: "Open this link within 15 minutes to reset your password: http://localhost:5173/reset-password?token=a%20b",
    },
  ]);
});
