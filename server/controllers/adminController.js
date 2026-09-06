const { matchedData } = require("express-validator");

const authService = require("../services/authService");
const bookingService = require("../services/bookingService");
const { queueBookingEmailSafely } = require("../services/bookingEmailService");
const serviceCatalogService = require("../services/serviceCatalogService");
const vehicleService = require("../services/vehicleService");
const workshopScheduleService = require("../services/workshopScheduleService");
const AppError = require("../utils/AppError");
const { toSafeAdminBooking } = require("../utils/bookingResponse");
const { toSafeAdminService } = require("../utils/serviceResponse");
const { toSafeAdminVehicle } = require("../utils/vehicleResponse");
const { toSafeWorkshopSchedule } = require("../utils/workshopScheduleResponse");

async function createInvitation(req, res) {
  const result = await authService.createAdminInvitation({
    email: req.validated.email,
    invitedBy: req.user._id,
  });
  res.status(201).json({
    message: "Administrator invitation created",
    invitedEmail: result.invitation.invitedEmail,
    expiresAt: result.invitation.expiresAt,
    invitationLink: result.invitationLink,
  });
}

async function listVehicles(req, res) {
  const query = matchedData(req, { locations: ["query"] });
  const { vehicles, pagination } = await vehicleService.adminListVehicles({
    page: query.page ?? 1,
    limit: query.limit ?? 20,
    status: query.status ?? "all",
    search: query.search ?? "",
  });
  res.status(200).json({
    vehicles: vehicles.map(toSafeAdminVehicle),
    pagination,
  });
}

async function listServices(req, res) {
  const query = matchedData(req, { locations: ["query"] });
  const { services, pagination } = await serviceCatalogService.adminListServices(query);
  res.status(200).json({
    services: services.map(toSafeAdminService),
    pagination,
  });
}

async function createService(req, res) {
  const service = await serviceCatalogService.createService(req.validated);
  res.status(201).json({ service: toSafeAdminService(service) });
}

async function updateService(req, res) {
  const service = await serviceCatalogService.updateService({
    serviceId: req.params.id,
    patch: req.validated,
  });
  if (!service) throw new AppError(404, "Service not found");
  res.status(200).json({ service: toSafeAdminService(service) });
}

async function getWorkshopSchedule(req, res) {
  const schedule = await workshopScheduleService.getWorkshopSchedule();
  if (!schedule) throw new AppError(503, "Workshop schedule is unavailable");
  res.status(200).json({ schedule: toSafeWorkshopSchedule(schedule) });
}

async function replaceWorkshopSchedule(req, res) {
  const schedule = await workshopScheduleService.replaceWorkshopSchedule({
    replacement: req.validated,
  });
  res.status(200).json({ schedule: toSafeWorkshopSchedule(schedule) });
}

async function listBookings(req, res) {
  const query = matchedData(req, { locations: ["query"] });
  const { bookings, pagination } = await bookingService.listAdminBookings(query);
  res.status(200).json({
    bookings: bookings.map(toSafeAdminBooking),
    pagination,
  });
}

async function getBooking(req, res) {
  const booking = await bookingService.getAdminBooking({ bookingId: req.params.id });
  res.status(200).json({ booking: toSafeAdminBooking(booking) });
}

async function changeBookingStatus(req, res) {
  const booking = await bookingService.transitionBooking({
    bookingId: req.params.id,
    actor: req.user,
    ...req.validated,
  });
  await queueBookingEmailSafely(booking, res);
  res.status(200).json({ booking: toSafeAdminBooking(booking) });
}

module.exports = {
  changeBookingStatus,
  createInvitation,
  createService,
  getBooking,
  getWorkshopSchedule,
  listBookings,
  listServices,
  listVehicles,
  replaceWorkshopSchedule,
  updateService,
};
