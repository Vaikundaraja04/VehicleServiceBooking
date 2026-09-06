const dashboardService = require("../services/dashboardService");

async function getDashboard(req, res) {
  const now = new Date();
  const dashboard = req.user.role === "admin"
    ? await dashboardService.getAdminDashboard({ now })
    : await dashboardService.getCustomerDashboard({ customerId: req.user._id, now });
  res.status(200).json({ dashboard });
}

module.exports = { getDashboard };
