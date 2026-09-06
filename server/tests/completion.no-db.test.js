require('./test-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../app');

test('profile endpoint requires authentication', async () => {
  const response = await request(app).patch('/api/profile').set('Origin', 'http://localhost:5173').send({ mobile: '9876543210' });
  assert.equal(response.status, 401);
});
test('customer management and reports require authentication', async () => {
  for (const route of ['/api/admin/customers', '/api/reports', '/api/admin/email-deliveries']) {
    const response = await request(app).get(route);
    assert.equal(response.status, 401, route);
  }
});
test('public contact configuration is available without secrets', async () => {
  const response = await request(app).get('/api/public/workshop');
  assert.equal(response.status, 200);
  assert.equal(typeof response.body.workshop.name, 'string');
  assert.equal(JSON.stringify(response.body).includes('gmailAppPassword'), false);
});
