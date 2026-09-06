const mongoose = require("mongoose");

const Service = require("../models/Service");
const AppError = require("../utils/AppError");
const {
  normalizeServiceName,
  toServiceNameKey,
  toServiceSlug,
} = require("../utils/serviceNormalization");

const EDITABLE_FIELDS = [
  "name",
  "category",
  "description",
  "durationMinutes",
  "isActive",
];
const DUPLICATE_MESSAGE = "A service with this name already exists";
const INVALID_NAME_MESSAGE = "Service name must contain at least one ASCII letter or number";

function duplicateShape(error) {
  return error?.keyPattern || error?.keyValue || {};
}

function isServiceIdentityDuplicate(error) {
  const shape = duplicateShape(error);
  return error?.code === 11000
    && (Object.hasOwn(shape, "slug") || Object.hasOwn(shape, "nameKey"));
}

function duplicateServiceError() {
  return new AppError(409, DUPLICATE_MESSAGE);
}

function serviceIdentity(value) {
  const name = normalizeServiceName(value);
  const slug = toServiceSlug(name);
  if (!slug) {
    throw new AppError(400, "Validation failed", [
      { field: "name", message: INVALID_NAME_MESSAGE },
    ]);
  }
  return {
    name,
    slug,
    nameKey: toServiceNameKey(name),
  };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createServiceCatalogService({
  Service: ServiceModel,
  isValidObjectId = mongoose.isValidObjectId,
}) {
  async function createService(input = {}) {
    const identity = serviceIdentity(input.name);
    try {
      return await ServiceModel.create({
        ...identity,
        category: input.category,
        description: input.description,
        durationMinutes: input.durationMinutes,
      });
    } catch (error) {
      if (isServiceIdentityDuplicate(error)) throw duplicateServiceError();
      throw error;
    }
  }

  async function updateService({ serviceId, patch = {} }) {
    if (!isValidObjectId(serviceId)) return null;

    const $set = {};
    for (const field of EDITABLE_FIELDS) {
      if (Object.hasOwn(patch, field)) $set[field] = patch[field];
    }
    if (Object.hasOwn($set, "name")) {
      const identity = serviceIdentity($set.name);
      $set.name = identity.name;
      $set.nameKey = identity.nameKey;
    }

    try {
      return await ServiceModel.findOneAndUpdate(
        { _id: serviceId },
        { $set, $inc: { bookingGuardVersion: 1 } },
        { new: true, runValidators: true },
      );
    } catch (error) {
      if (isServiceIdentityDuplicate(error)) throw duplicateServiceError();
      throw error;
    }
  }

  async function getActiveService(serviceId) {
    if (!isValidObjectId(serviceId)) return null;
    return ServiceModel.findOne({ _id: serviceId, isActive: true });
  }

  async function listActiveServices() {
    return ServiceModel.find({ isActive: true }).sort({ name: 1, _id: 1 });
  }

  async function adminListServices({
    page = 1,
    limit = 20,
    isActive,
    search = "",
  } = {}) {
    const filter = {};
    if (typeof isActive === "boolean") filter.isActive = isActive;
    const searchText = String(search).trim();
    if (searchText) {
      filter.name = { $regex: new RegExp(escapeRegex(searchText), "i") };
    }

    const totalItems = await ServiceModel.countDocuments(filter);
    const services = await ServiceModel.find(filter)
      .sort({ name: 1, _id: 1 })
      .skip((page - 1) * limit)
      .limit(limit);

    return {
      services,
      pagination: {
        page,
        limit,
        totalItems,
        totalPages: Math.ceil(totalItems / limit),
      },
    };
  }

  async function touchActiveService({ serviceId, session }) {
    return ServiceModel.findOneAndUpdate(
      { _id: serviceId, isActive: true },
      { $inc: { bookingGuardVersion: 1 } },
      { new: true, session, timestamps: false },
    );
  }

  return {
    createService,
    updateService,
    getActiveService,
    listActiveServices,
    adminListServices,
    touchActiveService,
  };
}

const serviceCatalog = createServiceCatalogService({ Service });

module.exports = {
  ...serviceCatalog,
  createServiceCatalogService,
};
