const express = require("express");
const multer = require("multer");
const cloudinary = require("../config/cloudinary");
const AppError = require("../utils/AppError");
const protect = require("../middleware/auth.middleware");
const messageController = require("../controllers/message.controller");

const router = express.Router({ mergeParams: true });

const allowedImageTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!allowedImageTypes.has(file.mimetype)) {
      return cb(
        new AppError("Only JPEG, PNG, WebP, and GIF images are allowed", 400),
      );
    }
    cb(null, true);
  },
});

router.use(protect);

router.get("/", messageController.getMessages);

router.post("/upload", upload.single("image"), async (req, res) => {
  if (!req.file) {
    throw new AppError("Image is required", 400);
  }

  const result = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: "chat-app", resource_type: "image" },
      (error, uploadResult) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(uploadResult);
      },
    );
    stream.end(req.file.buffer);
  });

  res.status(201).json({
    success: true,
    data: {
      imageUrl: result.secure_url,
    },
  });
});

module.exports = router;
