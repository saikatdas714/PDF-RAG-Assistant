const multer = require("multer");

// Use memory storage for serverless environments (Vercel, AWS Lambda)
// Prevents "EROFS: read-only file system" errors
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB max file size
  },
});

module.exports = upload;
