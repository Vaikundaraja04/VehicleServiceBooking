const AppError = require("../utils/AppError");

function authorize(...allowedRoles) {
  return function checkRole(req, res, next) {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return next(new AppError(403, "You do not have permission for this action"));
    }
    return next();
  };
}

module.exports = authorize;
