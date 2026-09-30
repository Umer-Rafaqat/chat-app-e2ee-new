const express = require("express");
const userController = require("../controllers/user.controller");
const protect = require("../middleware/auth.middleware");
const validate = require("../middleware/validate.middleware");
const { publicKeySchema } = require("../validators/user.validator");

const router = express.Router();

router.use(protect); // every route below requires authentication

router.get("/", userController.getUsers);

// A user may only ever set THEIR OWN public key (from req.user, not a body
// id) — nobody can overwrite someone else's encryption identity.
router.put(
  "/me/public-key",
  validate(publicKeySchema),
  userController.updatePublicKey,
);

router.get("/:id", userController.getUser);

module.exports = router;
