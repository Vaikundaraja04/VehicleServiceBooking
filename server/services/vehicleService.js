const mongoose = require("mongoose");

const User = require("../models/User");
const Vehicle = require("../models/Vehicle");
const AppError = require("../utils/AppError");
const { normalizeRegistrationNumber } = require("../utils/vehicleRegistration");

const EDITABLE_FIELDS = ["make", "model", "year", "fuelType"];
const LIMIT_MESSAGE = "Maximum of 5 active vehicles reached";
const DUPLICATE_MESSAGE = "This registration number is already registered";

function maximumActiveVehiclesError() {
  return new AppError(409, LIMIT_MESSAGE, [
    { field: "vehicles", message: LIMIT_MESSAGE },
  ]);
}

function duplicateRegistrationError() {
  return new AppError(409, DUPLICATE_MESSAGE, [
    { field: "registrationNumber", message: DUPLICATE_MESSAGE },
  ]);
}

function duplicateKeyShape(error) {
  return error?.keyPattern || error?.keyValue || {};
}

function isRegistrationDuplicate(error) {
  return error?.code === 11000 &&
    Object.hasOwn(duplicateKeyShape(error), "registrationNumber");
}

function isActiveSlotDuplicate(error) {
  const shape = duplicateKeyShape(error);
  return error?.code === 11000 &&
    Object.hasOwn(shape, "owner") &&
    Object.hasOwn(shape, "activeSlot");
}

async function listVehicles({ owner, status = "active" }) {
  const filter = { owner };
  if (status !== "all") filter.status = status;
  return Vehicle.find(filter).sort({ createdAt: -1, _id: -1 });
}

async function getVehicle({ owner, vehicleId }) {
  if (!mongoose.isValidObjectId(vehicleId)) return null;
  return Vehicle.findOne({ _id: vehicleId, owner });
}

async function updateVehicle({ owner, vehicleId, patch }) {
  if (!mongoose.isValidObjectId(vehicleId)) return null;
  const $set = {};
  for (const field of EDITABLE_FIELDS) {
    if (Object.hasOwn(patch, field)) $set[field] = patch[field];
  }
  return Vehicle.findOneAndUpdate(
    { _id: vehicleId, owner },
    { $set, $inc: { bookingGuardVersion: 1 } },
    { new: true, runValidators: true },
  );
}

async function createVehicle({
  owner,
  registrationNumber,
  make,
  model,
  year,
  fuelType,
}) {
  const normalizedRegistration = normalizeRegistrationNumber(registrationNumber);
  if (await Vehicle.exists({ registrationNumber: normalizedRegistration })) {
    throw duplicateRegistrationError();
  }

  for (let activeSlot = 1; activeSlot <= 5; activeSlot += 1) {
    try {
      return await Vehicle.create({
        owner,
        registrationNumber: normalizedRegistration,
        make,
        model,
        year,
        fuelType,
        status: "active",
        archivedAt: null,
        activeSlot,
      });
    } catch (error) {
      if (isRegistrationDuplicate(error)) throw duplicateRegistrationError();
      if (isActiveSlotDuplicate(error)) continue;
      throw error;
    }
  }

  if (await Vehicle.exists({ registrationNumber: normalizedRegistration })) {
    throw duplicateRegistrationError();
  }
  throw maximumActiveVehiclesError();
}

async function archiveVehicle({ owner, vehicleId }) {
  if (!mongoose.isValidObjectId(vehicleId)) return null;
  return Vehicle.findOneAndUpdate(
    { _id: vehicleId, owner, status: "active" },
    {
      $set: {
        status: "archived",
        archivedAt: new Date(),
        activeSlot: null,
      },
      $inc: { bookingGuardVersion: 1 },
    },
    { new: true, runValidators: true },
  );
}

async function restoreVehicle({ owner, vehicleId }) {
  if (!mongoose.isValidObjectId(vehicleId)) return null;
  const target = await Vehicle.findOne({ _id: vehicleId, owner })
    .select("status activeSlot")
    .lean();
  if (!target || target.status !== "archived" || target.activeSlot !== null) {
    return null;
  }

  for (let activeSlot = 1; activeSlot <= 5; activeSlot += 1) {
    try {
      const updated = await Vehicle.findOneAndUpdate(
        { _id: vehicleId, owner, status: "archived", activeSlot: null },
        {
          $set: {
            status: "active",
            archivedAt: null,
            activeSlot,
          },
          $inc: { bookingGuardVersion: 1 },
        },
        { new: true, runValidators: true },
      );
      if (!updated) return null;
      return updated;
    } catch (error) {
      if (isRegistrationDuplicate(error)) throw duplicateRegistrationError();
      if (isActiveSlotDuplicate(error)) continue;
      throw error;
    }
  }

  throw maximumActiveVehiclesError();
}

module.exports = {
  normalizeRegistrationNumber,
  createVehicle,
  listVehicles,
  getVehicle,
  updateVehicle,
  archiveVehicle,
  restoreVehicle,
  adminListVehicles,
};

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function adminListVehicles({
  page = 1,
  limit = 20,
  status = "all",
  search = "",
}) {
  const filter = {};
  if (status !== "all") filter.status = status;

  const searchText = String(search).trim();
  if (searchText) {
    const normalized = normalizeRegistrationNumber(searchText);
    const rawRegex = new RegExp(escapeRegex(searchText), "i");
    const matchingUserIds = (
      await User.find({
        $or: [{ username: rawRegex }, { email: rawRegex }],
      }).select("_id").lean()
    ).map((user) => user._id);

    const candidates = [
      { make: rawRegex },
      { model: rawRegex },
      { owner: { $in: matchingUserIds } },
    ];
    if (/^[A-Z0-9]{4,15}$/.test(normalized)) {
      candidates.unshift({ registrationNumber: normalized });
    }
    filter.$or = candidates;
  }

  const total = await Vehicle.countDocuments(filter);
  const vehicles = await Vehicle.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .populate("owner", "username email isActive");

  return {
    vehicles,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}
