const mongoose = require("mongoose");

const Booking = require("../models/Booking");
const Service = require("../models/Service");
const User = require("../models/User");
const Vehicle = require("../models/Vehicle");
const {
  MAX_BAY_COUNT,
  WORKSHOP_TIME_ZONE,
} = require("../config/bookingPolicy");
const {
  getDateInterval,
  validateOfferedStart,
} = require("./availabilityService");
const {
  assertTransitionAllowed,
  buildHistoryEntry,
  releasesCapacity,
} = require("./bookingStateMachine");
const {
  touchActiveService,
} = require("./serviceCatalogService");
const {
  touchWorkshopSchedule,
} = require("./workshopScheduleService");
const AppError = require("../utils/AppError");
const {
  isReservationKeyDuplicate,
} = require("../utils/bookingDuplicateKey");
const {
  buildReservedSlotKeys,
} = require("../utils/bookingReservation");

const BOOKING_NOT_FOUND = "Booking not found";
const STATUS_ERROR = "Booking status no longer permits this action";
const TIMING_ERROR = "Booking action is not allowed at this time";
const TERMINAL_STATUSES = ["completed", "cancelled", "rejected", "no_show"];

class BayUnavailable extends Error {}

function bookingNotFoundError() {
  return new AppError(404, BOOKING_NOT_FOUND);
}

function stableNow(value, currentDate) {
  const instant = value === undefined ? currentDate() : value;
  if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) {
    throw new AppError(409, TIMING_ERROR);
  }
  return instant;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function redactReservationKeys(booking) {
  if (!booking || typeof booking !== "object" || booking.reservedSlotKeys === undefined) {
    return booking;
  }
  if (typeof booking.set === "function") {
    booking.set("reservedSlotKeys", undefined);
  } else {
    delete booking.reservedSlotKeys;
  }
  return booking;
}

function pagination({ page, limit, totalItems }) {
  return {
    page,
    limit,
    totalItems,
    totalPages: Math.ceil(totalItems / limit),
  };
}

function createBookingService({
  Booking: BookingModel = Booking,
  Service: ServiceModel = Service,
  User: UserModel = User,
  Vehicle: VehicleModel = Vehicle,
  currentDate = () => new Date(),
  startSession = () => mongoose.startSession(),
  isValidObjectId = mongoose.isObjectIdOrHexString,
  touchActiveService: touchService = touchActiveService,
  touchWorkshopSchedule: touchSchedule = touchWorkshopSchedule,
  validateOfferedStart: validateStart = validateOfferedStart,
  buildReservedSlotKeys: buildSlotKeys = buildReservedSlotKeys,
  assertTransitionAllowed: assertTransition = assertTransitionAllowed,
  buildHistoryEntry: historyEntry = buildHistoryEntry,
  releasesCapacity: transitionReleasesCapacity = releasesCapacity,
  isReservationKeyDuplicate: isReservationDuplicate = isReservationKeyDuplicate,
  getDateInterval: dateInterval = getDateInterval,
} = {}) {
  async function inactiveServiceExists({ serviceId, session }) {
    const query = ServiceModel.exists({ _id: serviceId });
    if (query && typeof query.session === "function") return query.session(session);
    return query;
  }

  async function createBookingInBay({
    customer,
    vehicleId,
    serviceId,
    startsAt,
    notes,
    now,
    bayNumber,
    session,
  }) {
    if (!isValidObjectId(customer?._id) || !isValidObjectId(vehicleId)) {
      throw new AppError(404, "Vehicle not found");
    }

    const vehicle = await VehicleModel.findOneAndUpdate(
      { _id: vehicleId, owner: customer._id, status: "active" },
      { $inc: { bookingGuardVersion: 1 } },
      { new: true, session, timestamps: false },
    );
    if (!vehicle) throw new AppError(404, "Vehicle not found");

    if (!isValidObjectId(serviceId)) {
      throw new AppError(404, "Service not found");
    }
    const service = await touchService({ serviceId, session });
    if (!service) {
      if (await inactiveServiceExists({ serviceId, session })) {
        throw new AppError(409, "This service is currently unavailable");
      }
      throw new AppError(404, "Service not found");
    }

    const schedule = await touchSchedule({ session });
    if (!schedule) throw new AppError(503, "Workshop schedule is unavailable");
    if (bayNumber > schedule.bayCount) throw new BayUnavailable();

    const offered = validateStart({
      schedule,
      startsAt,
      durationMinutes: service.durationMinutes,
      now,
    });
    const reservedSlotKeys = buildSlotKeys({
      startsAt: offered.startsAt,
      durationMinutes: service.durationMinutes,
      bayNumber,
    });
    const document = {
      customer: customer._id,
      vehicle: vehicle._id,
      vehicleSnapshot: {
        registrationNumber: vehicle.registrationNumber,
        make: vehicle.make,
        model: vehicle.model,
        year: vehicle.year,
        fuelType: vehicle.fuelType,
      },
      service: service._id,
      serviceSnapshot: {
        name: service.name,
        slug: service.slug,
        category: service.category,
        durationMinutes: service.durationMinutes,
      },
      startsAt: offered.startsAt,
      endsAt: offered.endsAt,
      localDate: offered.localDate,
      timeZone: WORKSHOP_TIME_ZONE,
      bayNumber,
      reservedSlotKeys,
      status: "requested",
      statusHistory: [historyEntry({
        fromStatus: null,
        toStatus: "requested",
        actor: customer,
        changedAt: now,
      })],
    };
    if (notes !== undefined) document.notes = notes;

    const [booking] = await BookingModel.create([document], { session });
    return booking;
  }

  async function attemptBookingInBay(input) {
    const session = await startSession();
    let booking;
    try {
      await session.withTransaction(async () => {
        booking = await createBookingInBay({ ...input, session });
      });
      return { kind: "created", booking: redactReservationKeys(booking) };
    } catch (error) {
      if (error instanceof BayUnavailable) return { kind: "bay-unavailable" };
      if (isReservationDuplicate(error)) return { kind: "reservation-conflict" };
      throw error;
    } finally {
      await session.endSession();
    }
  }

  async function createInjectedBooking({ now, ...input }) {
    const effectiveNow = stableNow(now, currentDate);
    for (let bayNumber = 1; bayNumber <= MAX_BAY_COUNT; bayNumber += 1) {
      const attempt = await attemptBookingInBay({
        ...input,
        now: effectiveNow,
        bayNumber,
      });
      if (attempt.kind === "created") return attempt.booking;
      if (attempt.kind === "bay-unavailable") break;
    }
    throw new AppError(409, "That time is no longer available");
  }

  function customerScopeFilter({ scope, now }) {
    if (scope === "upcoming") {
      return {
        $or: [
          { status: { $in: ["requested", "confirmed"] }, endsAt: { $gte: now } },
          { status: "in_service" },
        ],
      };
    }
    if (scope === "history") {
      return {
        $or: [
          { status: { $in: TERMINAL_STATUSES } },
          { status: { $in: ["requested", "confirmed"] }, endsAt: { $lt: now } },
        ],
      };
    }
    return {};
  }

  async function listCustomerBookings({
    customer,
    scope = "upcoming",
    status,
    page = 1,
    limit = 20,
    now,
  }) {
    if (!isValidObjectId(customer?._id)) {
      return { bookings: [], pagination: pagination({ page, limit, totalItems: 0 }) };
    }
    const needsNow = scope === "upcoming" || scope === "history";
    const filter = {
      customer: customer._id,
      ...customerScopeFilter({
        scope,
        now: needsNow ? stableNow(now, currentDate) : undefined,
      }),
    };
    if (status !== undefined) filter.status = status;

    const totalItems = await BookingModel.countDocuments(filter);
    const sort = scope === "upcoming"
      ? { startsAt: 1, _id: 1 }
      : { startsAt: -1, _id: -1 };
    const bookings = await BookingModel.find(filter)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit);
    bookings.forEach(redactReservationKeys);

    return {
      bookings,
      pagination: pagination({ page, limit, totalItems }),
    };
  }

  async function getCustomerBooking({ customer, bookingId }) {
    if (!isValidObjectId(customer?._id) || !isValidObjectId(bookingId)) {
      throw bookingNotFoundError();
    }
    const booking = await BookingModel.findOne({
      _id: bookingId,
      customer: customer._id,
    });
    if (!booking) throw bookingNotFoundError();
    return redactReservationKeys(booking);
  }

  async function getAdminBooking({ bookingId }) {
    if (!isValidObjectId(bookingId)) throw bookingNotFoundError();
    const booking = await BookingModel.findOne({ _id: bookingId })
      .populate("customer", "username email");
    if (!booking) throw bookingNotFoundError();
    return redactReservationKeys(booking);
  }

  async function listAdminBookings({
    page = 1,
    limit = 20,
    status,
    dateFrom,
    dateTo,
    search = "",
  } = {}) {
    const filter = {};
    if (status !== undefined) filter.status = status;

    if (dateFrom || dateTo) {
      filter.startsAt = {};
      if (dateFrom) {
        filter.startsAt.$gte = dateInterval({
          localDate: dateFrom,
          timeZone: WORKSHOP_TIME_ZONE,
        }).startsAt;
      }
      if (dateTo) {
        filter.startsAt.$lt = dateInterval({
          localDate: dateTo,
          timeZone: WORKSHOP_TIME_ZONE,
        }).endsAt;
      }
    }

    const searchText = String(search).trim();
    if (searchText) {
      const expression = new RegExp(escapeRegex(searchText), "i");
      const matchingCustomers = await UserModel.find({
        $or: [{ username: expression }, { email: expression }],
      }).select("_id").lean();
      filter.$or = [
        { "vehicleSnapshot.registrationNumber": expression },
        { "serviceSnapshot.name": expression },
        { customer: { $in: matchingCustomers.map(({ _id }) => _id) } },
      ];
    }

    const totalItems = await BookingModel.countDocuments(filter);
    const bookings = await BookingModel.find(filter)
      .sort({ startsAt: 1, _id: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("customer", "username email");
    bookings.forEach(redactReservationKeys);
    return {
      bookings,
      pagination: pagination({ page, limit, totalItems }),
    };
  }

  async function transitionBooking({ bookingId, actor, toStatus, reason, now }) {
    if (!isValidObjectId(bookingId)
      || (actor?.role === "customer" && !isValidObjectId(actor?._id))) {
      throw bookingNotFoundError();
    }
    const effectiveNow = stableNow(now, currentDate);
    const targetFilter = actor?.role === "customer"
      ? { _id: bookingId, customer: actor._id }
      : { _id: bookingId };
    const current = await BookingModel.findOne(targetFilter);
    if (!current) throw bookingNotFoundError();

    assertTransition({
      currentStatus: current.status,
      toStatus,
      actorRole: actor?.role,
      startsAt: current.startsAt,
      now: effectiveNow,
      reason,
    });
    const update = {
      $set: { status: toStatus },
      $push: {
        statusHistory: historyEntry({
          fromStatus: current.status,
          toStatus,
          actor,
          reason,
          changedAt: effectiveNow,
        }),
      },
    };
    if (transitionReleasesCapacity(toStatus)) {
      update.$unset = { reservedSlotKeys: "" };
    }

    const updated = await BookingModel.findOneAndUpdate(
      { _id: bookingId, status: current.status },
      update,
      { new: true, runValidators: true },
    ).populate("customer", "username email");
    if (!updated) throw new AppError(409, STATUS_ERROR);
    return redactReservationKeys(updated);
  }

  function cancelBooking({ bookingId, actor, reason, now }) {
    return transitionBooking({
      bookingId,
      actor,
      toStatus: "cancelled",
      reason,
      now,
    });
  }

  return {
    createBooking: createInjectedBooking,
    listCustomerBookings,
    getCustomerBooking,
    getAdminBooking,
    listAdminBookings,
    cancelBooking,
    transitionBooking,
  };
}

const bookingService = createBookingService();

module.exports = {
  ...bookingService,
  createBookingService,
};
