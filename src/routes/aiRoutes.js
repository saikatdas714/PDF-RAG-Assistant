const express = require("express");
const upload = require("../middlewares/upload");
const {
  handleHealthCheck,
  handleUpload,
  handleAsk,
  handleClearSession,
} = require("../controllers/aiController");

const router = express.Router();

// Health check endpoint
router.get("/health", handleHealthCheck);

// PDF upload & indexing
router.post("/uploads", upload.single("pdf"), handleUpload);

// Question answering (supports JSON & multipart)
router.post("/ask", upload.single("pdf"), handleAsk);

// Delete session index from Qdrant
router.post("/clear-session", express.text({ type: "*/*" }), handleClearSession);

module.exports = router;
