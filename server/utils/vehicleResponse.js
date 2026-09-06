function identifier(value) {
  if (value?.id) {
    return value.id;
  }
  return value?._id?.toString();
}

function toSafeVehicle(vehicle) {
  const safe = {
    id: identifier(vehicle),
    registrationNumber: vehicle.registrationNumber,
    make: vehicle.make,
    model: vehicle.model,
    year: vehicle.year,
    fuelType: vehicle.fuelType,
    status: vehicle.status,
    createdAt: vehicle.createdAt,
    updatedAt: vehicle.updatedAt,
  };

  if (vehicle.archivedAt instanceof Date) {
    safe.archivedAt = vehicle.archivedAt;
  }

  return safe;
}

function toSafeAdminVehicle(vehicle) {
  const owner = vehicle.owner;
  return {
    ...toSafeVehicle(vehicle),
    owner: {
      id: identifier(owner),
      username: owner.username,
      email: owner.email,
      isActive: owner.isActive,
    },
  };
}

module.exports = { toSafeVehicle, toSafeAdminVehicle };