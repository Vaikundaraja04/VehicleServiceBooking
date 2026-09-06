const { formatJsonBodyLimitMessage } = require("../config/requestBodyPolicy");

function errorHandler(error, req, res, next) {
  let statusCode = error.statusCode || 500;
  let message = error.statusCode ? error.message : "Internal server error";
  let errors = error.errors;

  if (error.code === 11000) {
    const field = Object.keys(error.keyPattern || error.keyValue || {})[0] || "account";
    statusCode = 409;
    message = `${field === "account" ? "Account" : field} already exists`;
    errors = [{ field, message }];
  }

  if (error.type === "entity.too.large") {
    statusCode = 413;
    message = formatJsonBodyLimitMessage(error.limit);
    errors = undefined;
  }

  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    statusCode = 400;
    message = "Request body must contain valid JSON";
    errors = undefined;
  }

  const body = { message };
  if (Array.isArray(errors) && errors.length > 0) {
    body.errors = errors;
  }

  res.status(statusCode).json(body);
}

module.exports = errorHandler;
