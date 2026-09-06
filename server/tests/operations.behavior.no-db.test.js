require('./test-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../app');
const User = require('../models/User');
const { signAuthToken } = require('../services/jwtService');
const { csvCell, generateReport } = require('../services/reportService');
const { deliverNext, bookingMessage } = require('../services/bookingEmailService');
const accounts = require('../services/accountService');
const id = '507f1f77bcf86cd799439011';
const user = { _id: id, id, username: 'test_customer', role: 'customer', isActive: true, isEmailVerified: true, tokenVersion: 0 };
function authenticateAs(context, role = 'customer') {
  context.mock.method(User, 'findById', () => ({ select: async () => ({ ...user, role }) }));
  return `vsb_auth=${signAuthToken(user)}`;
}
test.afterEach(() => test.mock.restoreAll());

test('profile rejects privilege changes and malformed contact information', async t => {
  const cookie = authenticateAs(t);
  for (const body of [{ role: 'admin' }, { email: 'changed@gmail.com' }, { mobile: '123' }, { address: '' }, { username: { $ne: '' } }, {}]) {
    const response = await request(app).patch('/api/profile').set('Cookie', cookie).set('Origin', 'http://localhost:5173').send(body);
    assert.equal(response.status, 400, JSON.stringify(body));
  }
});
test('profile passes normalized data only for the signed-in account', async t => {
  const cookie = authenticateAs(t);
  let input;
  t.mock.method(accounts, 'updateProfile', async (actor, patch) => { input = { actor, patch }; return { ...user, ...patch }; });
  const response = await request(app).patch('/api/profile').set('Cookie', cookie).set('Origin', 'http://localhost:5173').send({ username: ' Test_User ', mobile: '9876543210', address: ' Chennai ' });
  assert.equal(response.status, 200);
  assert.equal(input.actor.id, id);
  assert.deepEqual(input.patch, { username: 'test_user', mobile: '9876543210', address: 'Chennai' });
});
test('customers cannot reach administrator operations or reports', async t => {
  const cookie = authenticateAs(t);
  for (const url of ['/api/admin/customers', '/api/admin/email-deliveries', '/api/reports?type=customers', '/api/reports?type=vehicles']) {
    const response = await request(app).get(url).set('Cookie', cookie);
    assert.equal(response.status, 403, url);
  }
  await assert.rejects(generateReport(user, { type: 'completed' }), e => e.statusCode === 403);
});
test('reports reject impossible, reversed and injected date queries', async t => {
  const cookie = authenticateAs(t, 'admin');
  for (const query of ['dateFrom=2026-02-30', 'dateFrom=2026-09-07&dateTo=2026-09-06', 'type=unknown', 'page=0', 'dateFrom[$ne]=x', 'format=html']) {
    const response = await request(app).get(`/api/reports?${query}`).set('Cookie', cookie);
    assert.equal(response.status, 400, query);
  }
});
test('customer updates reject role, credential and non-boolean access fields', async t => {
  const cookie = authenticateAs(t, 'admin');
  for (const body of [{ isActive: 'false' }, { role: 'admin' }, { passwordHash: 'x' }]) {
    const response = await request(app).patch(`/api/admin/customers/${id}`).set('Cookie', cookie).set('Origin', 'http://localhost:5173').send(body);
    assert.equal(response.status, 400);
  }
});
test('CSV escapes quotes and neutralizes spreadsheet formulas', () => {
  assert.equal(csvCell('a,"b"'), '"a,""b"""');
  for (const value of ['=SUM(1,2)', '+cmd', '-2+3', '@SUM(A1)', '  =1', '\tformula', '\rdata']) assert.ok(csvCell(value).startsWith('"\''), value);
  assert.equal(csvCell('TN01AB1234'), '"TN01AB1234"');
});
test('booking email uses the correct status, registration and India appointment time', () => {
  const message = bookingMessage({ _id: id, status: 'confirmed', startsAt: new Date('2026-09-07T04:30:00Z'), vehicleSnapshot: { registrationNumber: 'TN01AB1234' }, serviceSnapshot: { name: 'AC Service' } }, 'customer', 'http://localhost:5173');
  assert.match(message.subject, /Approved/);
  assert.match(message.text, /10:00 AM/);
  assert.match(message.text, /TN01AB1234/);
  assert.match(message.text, new RegExp(`/bookings/${id}`));
});
test('Gmail rejection schedules retry and never records a sent email', async () => {
  const changes = [];
  const Model = { findOneAndUpdate: () => ({ select: async () => ({ _id: id, to: 'recipient@gmail.com', subject: 'Status', text: 'Body', attempts: 1 }) }), updateOne: async (filter, update) => changes.push({ filter, update }) };
  await deliverNext({ Model, config: { gmailUser: 'sender@gmail.com' }, transport: { sendMail: async () => ({ accepted: [], rejected: ['recipient@gmail.com'] }) } });
  assert.equal(changes[0].update.$set.state, 'queued');
  assert.equal(changes[0].update.$set.lastError, 'DELIVERY_FAILED');
  assert.equal(changes[0].update.$set.sentAt, undefined);
});
test('Gmail acceptance records sent state, and the fifth failure stops retries', async () => {
  let update;
  const job = { _id: id, to: 'recipient@gmail.com', subject: 'Status', text: 'Body', attempts: 5 };
  const Model = { findOneAndUpdate: () => ({ select: async () => job }), updateOne: async (_filter, value) => { update = value; } };
  await deliverNext({ Model, config: { gmailUser: 'sender@gmail.com' }, transport: { sendMail: async () => ({ accepted: [job.to] }) } });
  assert.equal(update.$set.state, 'sent');
  await deliverNext({ Model, config: { gmailUser: 'sender@gmail.com' }, transport: { sendMail: async () => { throw Object.assign(new Error('private SMTP details'), { code: 'EAUTH' }); } } });
  assert.equal(update.$set.state, 'failed');
  assert.equal(update.$set.lastError, 'EAUTH');
  assert.equal(JSON.stringify(update).includes('private SMTP details'), false);
});
