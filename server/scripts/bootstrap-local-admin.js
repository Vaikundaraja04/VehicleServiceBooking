const mongoose = require('mongoose');
const User = require('../models/User');
const { buildFirstAdminDocument } = require('./create-first-admin-document');
async function main() {
  if (process.env.NODE_ENV !== 'development' || process.env.ENABLE_LOCAL_ADMIN_BOOTSTRAP !== 'true') throw new Error('Local administrator bootstrap is disabled');
  try {
    await mongoose.connect(process.env.MONGO_URI);
    if (!await User.exists({ role: 'admin' })) {
      const document = await buildFirstAdminDocument({ username: process.env.ADMIN_USERNAME || 'workshop_admin', email: process.env.GMAIL_USER, password: process.env.ADMIN_PASSWORD });
      await User.create(document);
      console.log('Your local administrator account was created. Credentials are in server/.env.');
    }
  } finally { await mongoose.disconnect(); }
}
if (require.main === module) main().catch(() => { console.error('Local administrator bootstrap failed. Check ADMIN_USERNAME and ADMIN_PASSWORD in server/.env.'); process.exitCode = 1; });
module.exports = { main };
