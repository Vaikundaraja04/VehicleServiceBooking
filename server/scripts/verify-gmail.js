const path = require('node:path');
const fs = require('node:fs');
const dotenv = require('dotenv');
const { validateGmail } = require('../../scripts/start-persistent');
const { createEmailTransport } = require('../config/email');

function loadEnvironment() {
  const envPath = path.join(__dirname, '..', '.env');
  // Match the persistent launcher's precedence: server/.env overrides shell values.
  return { ...process.env, ...(fs.existsSync(envPath) ? dotenv.parse(fs.readFileSync(envPath)) : {}) };
}

async function verifyGmail({ env = loadEnvironment(), createTransport = createEmailTransport, log = console.log } = {}) {
  const settings = { ...env };
  try { validateGmail(settings); }
  catch { throw Object.assign(new Error('Gmail configuration is incomplete'), { code: 'GMAIL_CONFIG' }); }
  const transport = createTransport({ gmailUser: settings.GMAIL_USER, gmailAppPassword: settings.GMAIL_APP_PASSWORD });
  try { await transport.verify(); log('Gmail SMTP authentication succeeded. This check does not send an email.'); }
  finally { transport.close(); }
}

function gmailFailureMessage(error) {
  // Never print raw SMTP errors: they can contain account or authentication details.
  const messages = {
    GMAIL_CONFIG: 'Set GMAIL_USER and a 16-character GMAIL_APP_PASSWORD in server/.env.',
    EAUTH: 'Gmail rejected authentication. Check the sender address and its Google App Password, and enable 2-Step Verification.',
    ETIMEDOUT: 'Gmail connection timed out. Check your network and whether Gmail SMTP on port 465 is allowed.',
    ECONNECTION: 'Could not connect to Gmail. Check your network and whether Gmail SMTP on port 465 is allowed.',
    ECONNREFUSED: 'Gmail connection was refused. Check network or firewall restrictions on SMTP port 465.',
    ECONNRESET: 'Gmail connection was interrupted. Check your network and try again.',
    ENOTFOUND: 'Gmail hostname could not be resolved. Check your internet connection and DNS settings.',
    EDNS: 'Gmail DNS lookup failed. Check your internet connection and DNS settings.',
    EAI_AGAIN: 'Gmail DNS lookup temporarily failed. Check your connection and try again.',
    ESOCKET: 'Gmail socket or TLS connection failed. Check the network, system clock and certificate settings.',
  };
  if (Object.hasOwn(messages, error?.code)) return `Gmail SMTP check failed [${error.code}]. ${messages[error.code]}`;
  return 'Gmail SMTP check failed. Check the Gmail settings and network connection; no email was sent.';
}

if (require.main === module) verifyGmail().catch(error => {
  console.error(gmailFailureMessage(error));
  process.exitCode = 1;
});

module.exports = { verifyGmail, gmailFailureMessage };
