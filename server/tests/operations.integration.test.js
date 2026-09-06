const test = require('node:test');
const assert = require('node:assert/strict');
const { DateTime } = require('luxon');
const User = require('../models/User');
const Vehicle = require('../models/Vehicle');
const Service = require('../models/Service');
const Booking = require('../models/Booking');
const DeletedBooking = require('../models/DeletedBooking');
const MailDelivery = require('../models/MailDelivery');
const { connectTestDb, clearTestDb, disconnectTestDb } = require('./helpers/testDb');
const { ensureDefaultWorkshopSchedule } = require('../services/workshopScheduleService');
const { createBooking, transitionBooking } = require('../services/bookingService');
const { updateProfile, updateCustomer, listCustomers } = require('../services/accountService');
const { generateReport } = require('../services/reportService');
const { deleteBooking } = require('../services/bookingDeletionService');
const { queueBookingEmail } = require('../services/bookingEmailService');

test.before(async () => { await connectTestDb(); for (const model of [User, Vehicle, Service, Booking, DeletedBooking, MailDelivery]) await model.init(); });
test.beforeEach(async () => { await clearTestDb(); await ensureDefaultWorkshopSchedule(); });
test.after(disconnectTestDb);
async function account(name, role = 'customer') {
  return User.create({ username: name, email: `${name}@example.com`, mobile: '9876543210', address: 'Chennai', passwordHash: 'integration-test-only-hash', role, isActive: true, isEmailVerified: true });
}
async function fixture(customer, number) {
  const vehicle = await Vehicle.create({ owner: customer._id, registrationNumber: `TN01AB${number}`, make: 'Tata', model: 'Nexon', year: 2025, fuelType: 'petrol', status: 'active', activeSlot: 1 });
  const service = await Service.create({ name: `Service ${number}`, category: 'maintenance', description: 'Integration fixture', durationMinutes: 30 });
  const startsAt = DateTime.now().setZone('Asia/Kolkata').plus({ weeks: 1 }).startOf('week').set({ hour: 10 }).toJSDate();
  return createBooking({ customer, vehicleId: vehicle._id, serviceId: service._id, startsAt });
}
test('profile edits persist safely and access changes revoke old sessions', async () => {
  const customer = await account('profile_customer');
  const saved = await updateProfile(customer, { address: 'Madurai' });
  assert.equal(saved.address, 'Madurai');
  assert.equal(saved.passwordHash, undefined);
  assert.equal(saved.tokenVersion, undefined);
  await updateCustomer(customer._id, { isActive: false });
  const updated = await User.findById(customer._id).select('+tokenVersion');
  assert.equal(updated.isActive, false);
  assert.equal(updated.tokenVersion, 1);
  assert.equal((await listCustomers({ status: 'inactive' })).pagination.total, 1);
});
test('customer reports isolate records, while admin reports include both customers', async () => {
  const a = await account('report_customer_a'); const b = await account('report_customer_b'); const admin = await account('report_admin', 'admin');
  await fixture(a, '1001'); await fixture(b, '1002');
  const mine = await generateReport(a, { type: 'bookings' });
  assert.equal(mine.pagination.total, 1); assert.equal(mine.rows[0].vehicle, 'TN01AB1001');
  assert.equal(mine.rows[0].email, undefined);
  assert.equal((await generateReport(admin, { type: 'pending' })).pagination.total, 2);
  assert.equal((await generateReport(a, { type: 'service-history' })).pagination.total, 0);
});
test('deletion refuses active bookings and preserves cancelled-booking audit evidence', async () => {
  const customer = await account('delete_customer'); const admin = await account('delete_admin', 'admin'); const booking = await fixture(customer, '1003');
  await assert.rejects(deleteBooking({ id: booking._id, actor: admin, reason: 'Duplicate request' }), e => e.statusCode === 409);
  await transitionBooking({ bookingId: booking._id, actor: admin, toStatus: 'cancelled', reason: 'Customer request' });
  await deleteBooking({ id: booking._id, actor: admin, reason: 'Duplicate request' });
  assert.equal(await Booking.findById(booking._id), null);
  const audit = await DeletedBooking.findOne({ bookingId: booking._id });
  assert.equal(audit.snapshot.status, 'cancelled');
  assert.equal(audit.reason, 'Duplicate request');
});
test('booking notification queue is idempotent for the same lifecycle event', async () => {
  const customer = await account('mail_customer'); const booking = await fixture(customer, '1004');
  await queueBookingEmail(booking); await queueBookingEmail(booking);
  assert.equal(await MailDelivery.countDocuments(), 1);
  const job = await MailDelivery.findOne();
  assert.equal(job.to, customer.email); assert.equal(job.state, 'queued');
});
