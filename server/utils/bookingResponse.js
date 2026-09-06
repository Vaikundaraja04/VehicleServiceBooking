const ACTOR_LABELS = Object.freeze({
  customer: "Customer",
  admin: "Administrator",
});

function identifier(value) {
  if (value == null) return undefined;
  if (typeof value === "string") return value;
  if (typeof value.toHexString === "function") return value.toHexString();
  return identifier(value.id ?? value._id);
}

function cloneDate(value) {
  return value instanceof Date ? new Date(value.getTime()) : value;
}

function toSafeVehicle(booking) {
  const snapshot = booking.vehicleSnapshot;
  return {
    id: identifier(booking.vehicle),
    registrationNumber: snapshot.registrationNumber,
    make: snapshot.make,
    model: snapshot.model,
    year: snapshot.year,
    fuelType: snapshot.fuelType,
  };
}

function toSafeServiceSnapshot(booking) {
  const snapshot = booking.serviceSnapshot;
  return {
    name: snapshot.name,
    slug: snapshot.slug,
    category: snapshot.category,
    durationMinutes: snapshot.durationMinutes,
  };
}

function toSafeCustomerHistoryEntry(entry) {
  return {
    fromStatus: entry.fromStatus ?? null,
    toStatus: entry.toStatus,
    changedAt: cloneDate(entry.changedAt),
    actorLabel: ACTOR_LABELS[entry.actor.role],
    reason: entry.reason ?? null,
  };
}

function toSafeAdminHistoryEntry(entry) {
  return {
    fromStatus: entry.fromStatus ?? null,
    toStatus: entry.toStatus,
    changedAt: cloneDate(entry.changedAt),
    actor: {
      id: identifier(entry.actor.userId),
      username: entry.actor.username,
      role: entry.actor.role,
    },
    reason: entry.reason ?? null,
  };
}

function bookingProjection(booking, historyMapper) {
  const safe = {
    id: identifier(booking),
    vehicle: toSafeVehicle(booking),
    service: toSafeServiceSnapshot(booking),
    startsAt: cloneDate(booking.startsAt),
    endsAt: cloneDate(booking.endsAt),
    localDate: booking.localDate,
    timeZone: booking.timeZone,
    status: booking.status,
  };

  if (booking.notes != null) {
    safe.notes = booking.notes;
  }

  safe.statusHistory = Array.from(booking.statusHistory || [], historyMapper);
  safe.createdAt = cloneDate(booking.createdAt);
  safe.updatedAt = cloneDate(booking.updatedAt);
  return safe;
}

function toSafeCustomerBooking(booking) {
  return bookingProjection(booking, toSafeCustomerHistoryEntry);
}

function toSafeAdminBooking(booking) {
  const safe = bookingProjection(booking, toSafeAdminHistoryEntry);
  safe.customer = {
    id: identifier(booking.customer),
    username: booking.customer?.username,
    email: booking.customer?.email,
  };
  safe.bayNumber = booking.bayNumber;
  return safe;
}

module.exports = { toSafeCustomerBooking, toSafeAdminBooking };
