const RESERVATION_INDEX_NAME = "uniq_booking_reserved_slot";

function hasNamedReservationIndex(error) {
  if (
    error?.index === RESERVATION_INDEX_NAME
    || error?.indexName === RESERVATION_INDEX_NAME
    || error?.errInfo?.indexName === RESERVATION_INDEX_NAME
  ) {
    return true;
  }

  const message = typeof error?.message === "string"
    ? error.message
    : (typeof error?.errmsg === "string" ? error.errmsg : "");
  return new RegExp(`\\bindex:\\s+${RESERVATION_INDEX_NAME}(?:\\s|$)`).test(message);
}

function hasExactReservationKeyPattern(error) {
  const pattern = error?.keyPattern;
  return pattern !== null
    && typeof pattern === "object"
    && !Array.isArray(pattern)
    && Object.keys(pattern).length === 1
    && pattern.reservedSlotKeys === 1;
}

function isReservationKeyDuplicate(error) {
  return error?.code === 11000
    && (hasNamedReservationIndex(error) || hasExactReservationKeyPattern(error));
}

module.exports = { isReservationKeyDuplicate };
