const User = require('../models/User');
const { toSafeUser } = require('../utils/userResponse');
const AppError = require('../utils/AppError');

function escapeSearch(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
async function updateProfile(user, patch) {
  const updated = await User.findOneAndUpdate({ _id: user._id, isActive: true }, { $set: patch }, { new: true, runValidators: true });
  if (!updated) throw new AppError(404, 'Account not found');
  return toSafeUser(updated);
}
async function listCustomers({ page = 1, limit = 20, search = '', status = 'all' }) {
  const filter = { role: 'customer' };
  if (status !== 'all') filter.isActive = status === 'active';
  if (search) {
    const pattern = new RegExp(escapeSearch(search), 'i');
    filter.$or = [{ username: pattern }, { email: pattern }, { mobile: pattern }];
  }
  const [customers, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit),
    User.countDocuments(filter),
  ]);
  return { customers: customers.map(toSafeUser), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}
async function updateCustomer(id, patch) {
  const update = { $set: patch };
  if (patch.isActive !== undefined) update.$inc = { tokenVersion: 1 };
  const customer = await User.findOneAndUpdate({ _id: id, role: 'customer' }, update, { new: true, runValidators: true });
  if (!customer) throw new AppError(404, 'Customer not found');
  return toSafeUser(customer);
}
module.exports = { updateProfile, listCustomers, updateCustomer };
