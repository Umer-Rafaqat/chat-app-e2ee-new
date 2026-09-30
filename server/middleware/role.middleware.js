const AppError = require("../utils/AppError");
const { ROLES } = require("../config/roles");

// Must run AFTER authenticateUser (protect): it relies on req.user, which is
// loaded from the database on every request, so role changes apply immediately.
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AppError("Not authenticated", 401));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(new AppError("You do not have permission to do this", 403));
    }

    next();
  };
}

const requireAdmin = requireRole(ROLES.ADMIN);

module.exports = { requireRole, requireAdmin };
