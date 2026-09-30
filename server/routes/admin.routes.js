const express = require("express");

const adminController = require("../controllers/admin.controller");
const protect = require("../middleware/auth.middleware");
const { requireAdmin } = require("../middleware/role.middleware");
const validate = require("../middleware/validate.middleware");
const validateObjectId = require("../middleware/validateObjectId.middleware");
const {
  updateUserStatusSchema,
  updateUserRoleSchema,
} = require("../validators/admin.validator");

const router = express.Router();

// Every /api/admin route: authenticate -> require admin role -> controller.
router.use(protect, requireAdmin);

router.get("/stats", adminController.getStats);

router.get("/users", adminController.listUsers);
router.get("/users/:id", validateObjectId("id"), adminController.getUser);
router.patch(
  "/users/:id/status",
  validateObjectId("id"),
  validate(updateUserStatusSchema),
  adminController.updateUserStatus,
);
router.patch(
  "/users/:id/role",
  validateObjectId("id"),
  validate(updateUserRoleSchema),
  adminController.updateUserRole,
);

router.get("/groups", adminController.getGroups);

module.exports = router;
