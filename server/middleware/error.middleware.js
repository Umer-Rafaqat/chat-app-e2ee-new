const AppError = require("../utils/AppError");

function errorMiddleware(err, req, res, next) {
  let error = err;

  if (err.code === "LIMIT_FILE_SIZE") {
    error = new AppError("Image must be 4MB or smaller", 413);
  }

  if (err.code === 11000) {
    error = new AppError("Duplicate value — resource already exists", 409);
  }

  if (err.name === "ValidationError") {
    const message = Object.values(err.errors)
      .map((e) => e.message)
      .join(", ");
    error = new AppError(message, 400);
  }

  // Malformed MongoDB ObjectId (e.g. /api/users/abc)
  if (err.name === "CastError") {
    error = new AppError(`Invalid ${err.path}: ${err.value}`, 400);
  }

  const statusCode = error.statusCode || 500;
  const message = error.isOperational ? error.message : "Something went wrong";

  if (statusCode === 500) {
    console.error(err);
  }

  res.status(statusCode).json({ success: false, message });
}

module.exports = errorMiddleware;
