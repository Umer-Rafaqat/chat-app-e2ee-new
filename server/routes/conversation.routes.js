const express = require("express");
const conversationController = require("../controllers/conversation.controller");
const protect = require("../middleware/auth.middleware");
const validate = require("../middleware/validate.middleware");
const validateObjectId = require("../middleware/validateObjectId.middleware");
const { requireAdmin } = require("../middleware/role.middleware");
const {
  createConversationSchema,
  createGroupSchema,
  updateGroupSchema,
} = require("../validators/conversation.validator");

const router = express.Router();

router.use(protect);

router.get("/", conversationController.getConversations);
router.post(
  "/",
  validate(createConversationSchema),
  conversationController.createConversation,
);

// ---- Admin only: group management (role check runs BEFORE validation) ----
router.post(
  "/group",
  requireAdmin,
  validate(createGroupSchema),
  conversationController.createGroup,
);
router.patch(
  "/:conversationId",
  requireAdmin,
  validateObjectId("conversationId"),
  validate(updateGroupSchema),
  conversationController.updateGroup,
);
router.delete(
  "/:conversationId",
  requireAdmin,
  validateObjectId("conversationId"),
  conversationController.deleteGroup,
);

router.get("/:conversationId", conversationController.getConversation);

module.exports = router;
