const serviceCatalogService = require("../services/serviceCatalogService");
const { toSafeService } = require("../utils/serviceResponse");

async function listActive(req, res) {
  const services = await serviceCatalogService.listActiveServices();
  res.status(200).json({ services: services.map(toSafeService) });
}

module.exports = { listActive };
