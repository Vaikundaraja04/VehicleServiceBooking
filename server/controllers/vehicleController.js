const { matchedData } = require("express-validator");

const vehicleService = require("../services/vehicleService");
const AppError = require("../utils/AppError");
const { toSafeVehicle } = require("../utils/vehicleResponse");

async function listVehicles(req, res) {
  const query = matchedData(req, { locations: ["query"] });
  const vehicles = await vehicleService.listVehicles({
    owner: req.user._id,
    status: query.status || "active",
  });
  res.status(200).json({ vehicles: vehicles.map(toSafeVehicle) });
}

async function getVehicle(req, res, next) {
  const vehicle = await vehicleService.getVehicle({
    owner: req.user._id,
    vehicleId: req.params.id,
  });
  if (!vehicle) return next(new AppError(404, "Vehicle not found"));
  return res.status(200).json(toSafeVehicle(vehicle));
}

async function createVehicle(req, res) {
  const vehicle = await vehicleService.createVehicle({
    owner: req.user._id,
    ...req.validated,
  });
  res.status(201).json(toSafeVehicle(vehicle));
}

async function updateVehicle(req, res, next) {
  const vehicle = await vehicleService.updateVehicle({
    owner: req.user._id,
    vehicleId: req.params.id,
    patch: req.validated,
  });
  if (!vehicle) return next(new AppError(404, "Vehicle not found"));
  return res.status(200).json(toSafeVehicle(vehicle));
}

async function archiveVehicle(req, res, next) {
  const vehicle = await vehicleService.archiveVehicle({
    owner: req.user._id,
    vehicleId: req.params.id,
  });
  if (!vehicle) return next(new AppError(404, "Vehicle not found"));
  return res.status(200).json(toSafeVehicle(vehicle));
}

async function restoreVehicle(req, res, next) {
  const vehicle = await vehicleService.restoreVehicle({
    owner: req.user._id,
    vehicleId: req.params.id,
  });
  if (!vehicle) return next(new AppError(404, "Vehicle not found"));
  return res.status(200).json(toSafeVehicle(vehicle));
}

module.exports = {
  listVehicles,
  getVehicle,
  createVehicle,
  updateVehicle,
  archiveVehicle,
  restoreVehicle,
};