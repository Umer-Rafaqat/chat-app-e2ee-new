const AppError = require("../utils/AppError");

const OBJECT_ID_REGEX = /^[a-f\d]{24}$/i;

// Rejects malformed ids with a clean 400 before they reach a query.
function validateObjectId(...paramNames) {
  return (req, res, next) => {
    for (const name of paramNames) {
      if (!OBJECT_ID_REGEX.test(String(req.params[name]))) {
        return next(new AppError(`Invalid ${name}`, 400));
      }
    }
    next();
  };
}

module.exports = validateObjectId;
