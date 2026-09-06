const { DateTime } = require("luxon");
const mongoose = require("mongoose");

const { WORKSHOP_TIME_ZONE } = require("../config/bookingPolicy");
const Booking = require("../models/Booking");
const User = require("../models/User");
const Vehicle = require("../models/Vehicle");
const WorkshopSchedule = require("../models/WorkshopSchedule");
const AppError = require("../utils/AppError");
const {
  toAdminDashboard,
  toCustomerDashboard,
} = require("../utils/dashboardResponse");
const { resolveOpeningInterval } = require("./availabilityService");

function assertValidNow(now) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError("Dashboard now must be a valid Date");
  }
}

function createDashboardService({
  Booking: BookingModel = Booking,
  Vehicle: VehicleModel = Vehicle,
  WorkshopSchedule: WorkshopScheduleModel = WorkshopSchedule,
  User: UserModel = User,
  resolveOpeningInterval: openingInterval = resolveOpeningInterval,
  isValidObjectId = mongoose.isValidObjectId,
} = {}) {
  async function getCustomerDashboard({ customerId, now }) {
    assertValidNow(now);
    if (!isValidObjectId(customerId)) {
      throw new TypeError("Dashboard customer identifier is invalid");
    }

    const upcomingFilter = {
      $or: [
        { status: { $in: ["requested", "confirmed"] }, endsAt: { $gte: now } },
        { status: "in_service" },
      ],
    };
    const pipeline = [
      { $match: { customer: customerId } },
      {
        $facet: {
          upcomingBookings: [
            { $match: upcomingFilter },
            { $count: "count" },
          ],
          completedBookings: [
            { $match: { status: "completed" } },
            { $count: "count" },
          ],
          nextBooking: [
            { $match: upcomingFilter },
            { $sort: { startsAt: 1, _id: 1 } },
            { $limit: 1 },
            {
              $project: {
                _id: 1,
                vehicle: 1,
                "vehicleSnapshot.registrationNumber": 1,
                "vehicleSnapshot.make": 1,
                "vehicleSnapshot.model": 1,
                "vehicleSnapshot.year": 1,
                "vehicleSnapshot.fuelType": 1,
                "serviceSnapshot.name": 1,
                "serviceSnapshot.slug": 1,
                "serviceSnapshot.category": 1,
                "serviceSnapshot.durationMinutes": 1,
                startsAt: 1,
                endsAt: 1,
                localDate: 1,
                timeZone: 1,
                status: 1,
              },
            },
          ],
          recentActivity: [
            {
              $unwind: {
                path: "$statusHistory",
                includeArrayIndex: "historyIndex",
              },
            },
            {
              $sort: {
                "statusHistory.changedAt": -1,
                _id: 1,
                historyIndex: -1,
              },
            },
            { $limit: 5 },
            {
              $project: {
                _id: 0,
                bookingId: "$_id",
                toStatus: "$statusHistory.toStatus",
                changedAt: "$statusHistory.changedAt",
                actor: "$statusHistory.actor",
                reason: "$statusHistory.reason",
              },
            },
          ],
        },
      },
    ];

    const [activeVehicles, [facets = {}]] = await Promise.all([
      VehicleModel.countDocuments({ owner: customerId, status: "active" }),
      BookingModel.aggregate(pipeline),
    ]);

    return toCustomerDashboard({
      now,
      activeVehicles,
      upcomingBookings: facets.upcomingBookings?.[0]?.count ?? 0,
      completedBookings: facets.completedBookings?.[0]?.count ?? 0,
      nextBooking: facets.nextBooking?.[0] ?? null,
      recentActivity: facets.recentActivity ?? [],
    });
  }

  async function getAdminDashboard({ now }) {
    assertValidNow(now);

    const localNow = DateTime.fromJSDate(now, { zone: WORKSHOP_TIME_ZONE });
    const firstDay = localNow.startOf("day");
    const dates = Array.from({ length: 7 }, (_value, index) =>
      firstDay.plus({ days: index }).toISODate());
    const todayStart = firstDay.toUTC().toJSDate();
    const tomorrowStart = firstDay.plus({ days: 1 }).toUTC().toJSDate();
    const afterSeventhStart = firstDay.plus({ days: 7 }).toUTC().toJSDate();
    const attentionEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const schedule = await WorkshopScheduleModel.findOne({ key: "default" }).lean();
    if (!schedule) {
      throw new AppError(503, "Workshop schedule is unavailable");
    }

    const liveStatusFilter = {
      status: { $in: ["requested", "confirmed", "in_service"] },
      reservedSlotKeys: { $exists: true },
    };
    const pipeline = [{
      $facet: {
        totalBookings: [{ $count: "count" }],
        byStatus: [
          { $group: { _id: "$status", count: { $sum: 1 } } },
          { $sort: { _id: 1 } },
        ],
        todayAppointments: [
          {
            $match: {
              ...liveStatusFilter,
              startsAt: { $gte: todayStart, $lt: tomorrowStart },
            },
          },
          { $count: "count" },
        ],
        workload: [
          {
            $match: {
              ...liveStatusFilter,
              startsAt: { $gte: todayStart, $lt: afterSeventhStart },
            },
          },
          {
            $group: {
              _id: "$localDate",
              appointmentCount: { $sum: 1 },
              reservedMinutes: { $sum: "$serviceSnapshot.durationMinutes" },
            },
          },
          {
            $project: {
              _id: 0,
              date: "$_id",
              appointmentCount: 1,
              reservedMinutes: 1,
            },
          },
          { $sort: { date: 1 } },
        ],
        attention: [
          {
            $match: {
              $or: [
                { status: "confirmed", startsAt: { $lte: now } },
                {
                  status: "requested",
                  startsAt: { $gte: now, $lte: attentionEnd },
                },
                { status: "in_service" },
              ],
            },
          },
          {
            $addFields: {
              priority: {
                $switch: {
                  branches: [
                    { case: { $eq: ["$status", "confirmed"] }, then: 1 },
                    { case: { $eq: ["$status", "requested"] }, then: 2 },
                    { case: { $eq: ["$status", "in_service"] }, then: 3 },
                  ],
                  default: 4,
                },
              },
              kind: {
                $switch: {
                  branches: [
                    {
                      case: { $eq: ["$status", "confirmed"] },
                      then: "overdue_confirmed",
                    },
                    {
                      case: { $eq: ["$status", "requested"] },
                      then: "requested_soon",
                    },
                    {
                      case: { $eq: ["$status", "in_service"] },
                      then: "in_service",
                    },
                  ],
                  default: null,
                },
              },
            },
          },
          { $sort: { priority: 1, startsAt: 1, _id: 1 } },
          { $limit: 5 },
          {
            $lookup: {
              from: UserModel.collection.name,
              localField: "customer",
              foreignField: "_id",
              as: "customer",
            },
          },
          { $unwind: "$customer" },
          {
            $project: {
              _id: 1,
              kind: 1,
              startsAt: 1,
              status: 1,
              "customer._id": 1,
              "customer.username": 1,
              "customer.email": 1,
              "vehicleSnapshot.registrationNumber": 1,
              "serviceSnapshot.name": 1,
            },
          },
        ],
      },
    }];

    const [facets = {}] = await BookingModel.aggregate(pipeline);
    const workloadByDate = new Map(
      (facets.workload ?? []).map((row) => [row.date, row]),
    );
    const byStatus = Object.fromEntries(
      (facets.byStatus ?? []).map((row) => [row._id, row.count]),
    );

    return toAdminDashboard({
      now,
      totalBookings: facets.totalBookings?.[0]?.count ?? 0,
      todayAppointments: facets.todayAppointments?.[0]?.count ?? 0,
      byStatus,
      workload: dates.map((date) => {
        const row = workloadByDate.get(date);
        const reservedMinutes = row?.reservedMinutes ?? 0;
        const opening = openingInterval({ schedule, localDate: date });
        const availableBayMinutes = opening
          ? opening.endsAt.diff(opening.startsAt, "minutes").minutes * schedule.bayCount
          : 0;
        const utilizationPercent = availableBayMinutes === 0
          ? 0
          : Math.min(
            100,
            Math.round((reservedMinutes / availableBayMinutes) * 1000) / 10,
          );
        return {
          date,
          appointmentCount: row?.appointmentCount ?? 0,
          reservedMinutes,
          availableBayMinutes,
          utilizationPercent,
        };
      }),
      attention: facets.attention ?? [],
    });
  }

  return { getAdminDashboard, getCustomerDashboard };
}

const dashboardService = createDashboardService({
  Booking,
  Vehicle,
  WorkshopSchedule,
  User,
  resolveOpeningInterval,
});

module.exports = { ...dashboardService, createDashboardService };
