const assert = require('node:assert/strict');
const { test } = require('node:test');
const { verifyGmail, gmailFailureMessage } = require('../scripts/verify-gmail');

const configured = { GMAIL_USER: 'sender@gmail.com', GMAIL_APP_PASSWORD: 'abcd efgh ijkl mnop' };

test('Gmail check authenticates with normalized settings, closes and sends no email', async () => {
  const calls = [];
  await verifyGmail({
    env: configured,
    createTransport: config => {
      assert.deepEqual(config, { gmailUser: 'sender@gmail.com', gmailAppPassword: 'abcdefghijklmnop' });
      return { verify: async () => calls.push('verify'), close: () => calls.push('close'), sendMail: () => assert.fail('Check must not send email') };
    },
    log: message => calls.push(message),
  });
  assert.equal(calls[0], 'verify');
  assert.match(calls[1], /does not send an email/);
  assert.equal(calls[2], 'close');
});

test('Gmail check rejects missing configuration before connecting', async () => {
  await assert.rejects(verifyGmail({ env: {}, createTransport: () => assert.fail('Must not connect') }), { code: 'GMAIL_CONFIG' });
});

test('Gmail rejection closes transport and prints no success', async () => {
  const failure = Object.assign(new Error('Private server response'), { code: 'EAUTH' });
  let closed = false;
  await assert.rejects(verifyGmail({
    env: configured,
    createTransport: () => ({ verify: async () => { throw failure; }, close: () => { closed = true; } }),
    log: () => assert.fail('Must not print success'),
  }), failure);
  assert.equal(closed, true);
  assert.match(gmailFailureMessage(failure), /EAUTH.*App Password/);
  assert.doesNotMatch(gmailFailureMessage(failure), /Private server response/);
});

test('Gmail diagnostic distinguishes network problems and never prints unknown error details', () => {
  assert.match(gmailFailureMessage({ code: 'ETIMEDOUT' }), /ETIMEDOUT.*network/);
  assert.match(gmailFailureMessage({ code: 'ENOTFOUND' }), /ENOTFOUND.*DNS/);
  assert.match(gmailFailureMessage({ code: 'GMAIL_CONFIG' }), /server\/\.env/);
  const privateFailure = { code: 'private-token', message: 'secret-password', response: 'secret-response' };
  assert.doesNotMatch(gmailFailureMessage(privateFailure), /private-token|secret/);
});
