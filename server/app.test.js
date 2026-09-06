const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const app = require("./app");

test("GET /api/health returns API status", async () => {
  const response = await request(app).get("/api/health");

  assert.equal(response.statusCode, 200);

  assert.deepEqual(response.body, {
    message: "Vehicle Service Booking API is running",
  });
});