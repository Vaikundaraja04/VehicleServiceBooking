const { DateTime } = require('luxon');
const Booking = require('../models/Booking');
const User = require('../models/User');
const Vehicle = require('../models/Vehicle');
const AppError = require('../utils/AppError');

function csvCell(value) {
  let text = String(value ?? '');
  // Quote every cell and neutralize spreadsheet formula/control prefixes.
  if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
function toCsv(columns, rows) {
  return '\uFEFF' + [columns.map(c => csvCell(c.label)).join(','), ...rows.map(row => columns.map(c => csvCell(row[c.key])).join(','))].join('\r\n');
}
function column(key, label) { return { key, label }; }
async function generateReport(user, { type = 'bookings', dateFrom, dateTo, page = 1, limit = 20, format = 'json' } = {}) {
  if (user.role !== 'admin' && !['bookings', 'service-history'].includes(type)) throw new AppError(403, 'This report is for administrators only');
  const filter = {};
  let Model, columns, project;
  if (type === 'customers') {
    Model = User; filter.role = 'customer';
    columns = [column('username', 'Username'), column('email', 'Email'), column('mobile', 'Mobile'), column('address', 'Address'), column('status', 'Account status')];
    project = row => ({ id: String(row._id), username: row.username, email: row.email, mobile: row.mobile, address: row.address, status: row.isActive ? 'Active' : 'Inactive' });
  } else if (type === 'vehicles') {
    Model = Vehicle;
    columns = [column('registrationNumber', 'Registration'), column('make', 'Brand'), column('model', 'Model'), column('year', 'Year'), column('fuelType', 'Fuel'), column('status', 'Status'), column('customer', 'Customer')];
    project = row => ({ id: String(row._id), registrationNumber: row.registrationNumber, make: row.make, model: row.model, year: row.year, fuelType: row.fuelType, status: row.status, customer: row.owner?.username || 'Unavailable' });
  } else {
    Model = Booking;
    if (user.role === 'customer') filter.customer = user._id;
    if (type === 'pending') filter.status = 'requested';
    if (['completed', 'service-history'].includes(type)) filter.status = 'completed';
    columns = [column('reference', 'Booking reference'), column('date', 'Appointment date'), column('time', 'Time (India)'), column('vehicle', 'Vehicle'), column('service', 'Service'), column('status', 'Status')];
    if (user.role === 'admin') columns.push(column('customer', 'Customer'), column('email', 'Email'));
    project = row => ({ id: String(row._id), reference: String(row._id), date: row.localDate, time: DateTime.fromJSDate(row.startsAt).setZone('Asia/Kolkata').toFormat('HH:mm'), vehicle: row.vehicleSnapshot.registrationNumber, service: row.serviceSnapshot.name, status: row.status.replaceAll('_', ' '), ...(user.role === 'admin' ? { customer: row.customer?.username || 'Unavailable', email: row.customer?.email || '' } : {}) });
  }
  if (dateFrom || dateTo) {
    if (Model === Booking) filter.localDate = { ...(dateFrom ? { $gte: dateFrom } : {}), ...(dateTo ? { $lte: dateTo } : {}) };
    else filter.createdAt = { ...(dateFrom ? { $gte: DateTime.fromISO(dateFrom, { zone: 'Asia/Kolkata' }).toJSDate() } : {}), ...(dateTo ? { $lt: DateTime.fromISO(dateTo, { zone: 'Asia/Kolkata' }).plus({ days: 1 }).toJSDate() } : {}) };
  }
  const total = await Model.countDocuments(filter);
  if (format === 'csv' && total > 10000) throw new AppError(422, 'More than 10,000 records match. Narrow the date range before exporting.');
  let query = Model.find(filter).sort(Model === Booking ? { startsAt: -1, _id: -1 } : { createdAt: -1, _id: -1 });
  if (Model === Booking && user.role === 'admin') query = query.populate('customer', 'username email');
  if (Model === Vehicle) query = query.populate('owner', 'username');
  query = query.skip(format === 'csv' ? 0 : (page - 1) * limit).limit(format === 'csv' ? 10000 : limit);
  const rows = (await query.lean()).map(project);
  return { type, generatedAt: new Date().toISOString(), columns, rows, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }, dateBasis: Model === Booking ? 'Appointment date (Asia/Kolkata)' : 'Record creation date (Asia/Kolkata)' };
}
module.exports = { generateReport, csvCell, toCsv };
