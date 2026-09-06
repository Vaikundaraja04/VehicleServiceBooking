const test = require('node:test');
const assert = require('node:assert/strict');
const { validateGmail, persistentOptions } = require('./start-persistent');
test('persistent mode refuses missing or placeholder Gmail credentials', () => {
  assert.throws(() => validateGmail({}), /GMAIL/);
  assert.throws(() => validateGmail({ GMAIL_USER: 'not-configured@example.invalid', GMAIL_APP_PASSWORD: 'change-me' }), /GMAIL/);
  assert.throws(() => validateGmail({ GMAIL_USER: 'user@gmail.com', GMAIL_APP_PASSWORD: 'short' }), /App Password/);
});
test('persistent mode normalizes Gmail app-password spacing', () => {
  const env = { GMAIL_USER: ' user@gmail.com ', GMAIL_APP_PASSWORD: 'abcd efgh ijkl mnop' };
  validateGmail(env);
  assert.equal(env.GMAIL_USER, 'user@gmail.com');
  assert.equal(env.GMAIL_APP_PASSWORD, 'abcdefghijklmnop');
});
test('persistent MongoDB reuses one disk path, port and replica-set name', () => {
  const options = persistentOptions('/project/.local/mongo', 'win32');
  assert.equal(options.instanceOpts[0].dbPath, '/project/.local/mongo');
  assert.equal(options.instanceOpts[0].port, 27019);
  assert.equal(options.replSet.name, 'rs0');
  assert.equal(options.replSet.ip, '127.0.0.1');
  assert.deepEqual(options.replSet.args, []);
});
