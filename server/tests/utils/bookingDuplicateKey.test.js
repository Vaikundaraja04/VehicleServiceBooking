const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isReservationKeyDuplicate,
} = require("../../utils/bookingDuplicateKey");

test("recognizes only the named reservation index duplicate", () => {
  for (const error of [
    { code: 11000, index: "uniq_booking_reserved_slot" },
    { code: 11000, indexName: "uniq_booking_reserved_slot" },
    { code: 11000, errInfo: { indexName: "uniq_booking_reserved_slot" } },
    {
      code: 11000,
      message: "E11000 duplicate key error collection: test.bookings index: uniq_booking_reserved_slot dup key",
    },
  ]) {
    assert.equal(isReservationKeyDuplicate(error), true);
  }
});

test("uses only the exact sole reservedSlotKeys keyPattern as a fallback", () => {
  assert.equal(isReservationKeyDuplicate({
    code: 11000,
    keyPattern: { reservedSlotKeys: 1 },
  }), true);

  for (const error of [
    null,
    { code: 11001, keyPattern: { reservedSlotKeys: 1 } },
    { code: 11000, keyPattern: { reservedSlotKeys: -1 } },
    { code: 11000, keyPattern: { reservedSlotKeys: 1, customer: 1 } },
    { code: 11000, keyValue: { reservedSlotKeys: "slot" } },
    { code: 11000, index: "uniq_booking_reserved_slot_extra" },
    { code: 11000, message: "index: uniq_booking_reserved_slot_extra dup key" },
    { code: 11000, keyPattern: { email: 1 } },
  ]) {
    assert.equal(isReservationKeyDuplicate(error), false);
  }
});
