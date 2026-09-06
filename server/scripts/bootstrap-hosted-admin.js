const User = require('../models/User');
const { buildFirstAdminDocument } = require('./create-first-admin-document');

// Called only by the hosted startup, before the HTTP listener opens.
async function bootstrapHostedAdmin(env = process.env) {
  if (env.BOOTSTRAP_ADMIN !== 'true') return 'disabled';
  if (await User.exists({ role: 'admin' })) return 'existing';
  const document = await buildFirstAdminDocument({
    username: env.ADMIN_USERNAME, email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD,
  });
  if (await User.exists({ $or: [{ email: document.email }, { username: document.username }] })) {
    throw new Error('The administrator email or username already belongs to an account; no account was changed');
  }
  try {
    await User.create(document);
  } catch (error) {
    if (error.code === 11000 && await User.exists({ role: 'admin', email: document.email, username: document.username })) return 'existing';
    throw new Error('First administrator creation failed; check the database indexes and account identifiers', { cause: error });
  }
  return 'created';
}

module.exports = { bootstrapHostedAdmin };
