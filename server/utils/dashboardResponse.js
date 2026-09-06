const ACTOR_LABELS = Object.freeze({
  customer: "Customer",
  admin: "Administrator",
});
const ATTENTION_KINDS = Object.freeze({
  overdue_confirmed: "overdue_confirmed",
  requested_soon: "requested_soon",
  in_service: "in_service",
});
const { BOOKING_STATUSES } = require("../config/bookingPolicy");

function identifier(value) {
  if (value == null) return undefined;
  if (typeof value === "string") return value;
  if (typeof value.toHexString === "function") return value.toHexString();
  return identifier(value.id ?? value._id);
}

function cloneDate(value) {
  return value instanceof Date ? new Date(value.getTime()) : value;
}

function customerAction({ nextBooking, activeVehicles }) {
  if (nextBooking) {
    return {
      kind: "view_booking",
      href: `/bookings/${identifier(nextBooking)}`,
      label: "View your next appointment",
    };
  }
  if (activeVehicles > 0) {
    return {
      kind: "book_service",
      href: "/book-service",
      label: "Book a service",
    };
  }
  return {
    kind: "add_vehicle",
    href: "/vehicles",
    label: "Add your first vehicle",
  };
}

function customerBooking(booking) {
  return {
    id: identifier(booking),
    vehicle: {
      id: identifier(booking.vehicle),
      registrationNumber: booking.vehicleSnapshot.registrationNumber,
      make: booking.vehicleSnapshot.make,
      model: booking.vehicleSnapshot.model,
      year: booking.vehicleSnapshot.year,
      fuelType: booking.vehicleSnapshot.fuelType,
    },
    service: {
      name: booking.serviceSnapshot.name,
      slug: booking.serviceSnapshot.slug,
      category: booking.serviceSnapshot.category,
      durationMinutes: booking.serviceSnapshot.durationMinutes,
    },
    startsAt: cloneDate(booking.startsAt),
    endsAt: cloneDate(booking.endsAt),
    localDate: booking.localDate,
    timeZone: booking.timeZone,
    status: booking.status,
  };
}

function customerActivity(entry) {
  return {
    bookingId: identifier(entry.bookingId),
    toStatus: entry.toStatus,
    changedAt: cloneDate(entry.changedAt),
    actorLabel: ACTOR_LABELS[entry.actor.role],
    reason: entry.reason ?? null,
  };
}

function toCustomerDashboard(input) {
  const nextBooking = input.nextBooking ? customerBooking(input.nextBooking) : null;

  return {
    role: "customer",
    generatedAt: cloneDate(input.now),
    summary: {
      activeVehicles: input.activeVehicles,
      upcomingBookings: input.upcomingBookings,
      completedBookings: input.completedBookings,
    },
    nextBooking,
    action: customerAction({
      nextBooking: input.nextBooking,
      activeVehicles: input.activeVehicles,
    }),
    recentActivity: Array.from(input.recentActivity || [])
      .slice(0, 5)
      .map(customerActivity),
  };
}

function workloadRow(row) {
  return {
    date: row.date,
    appointmentCount: row.appointmentCount,
    reservedMinutes: row.reservedMinutes,
    availableBayMinutes: row.availableBayMinutes,
    utilizationPercent: row.utilizationPercent,
  };
}

function attentionItem(item) {
  const kind = ATTENTION_KINDS[item.kind];
  if (!kind) throw new TypeError("Dashboard attention kind is invalid");

  const bookingId = identifier(item);
  return {
    kind,
    bookingId,
    startsAt: cloneDate(item.startsAt),
    status: item.status,
    customer: {
      id: identifier(item.customer),
      username: item.customer.username,
      email: item.customer.email,
    },
    vehicleRegistrationNumber: item.vehicleSnapshot.registrationNumber,
    serviceName: item.serviceSnapshot.name,
    href: `/admin/bookings/${bookingId}`,
  };
}

function toAdminDashboard(input) {
  const byStatus = {};
  for (const status of BOOKING_STATUSES) {
    byStatus[status] = input.byStatus?.[status] ?? 0;
  }

  return {
    role: "admin",
    generatedAt: cloneDate(input.now),
    summary: {
      totalBookings: input.totalBookings,
      todayAppointments: input.todayAppointments,
      byStatus,
    },
    workload: Array.from(input.workload || []).slice(0, 7).map(workloadRow),
    attention: Array.from(input.attention || []).slice(0, 5).map(attentionItem),
  };
}

module.exports = { toCustomerDashboard, toAdminDashboard };
