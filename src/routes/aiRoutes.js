const express = require("express");
const upload = require("../middlewares/upload");
const {
  handleHealthCheck,
  handleUpload,
  handleAsk,
  handleAskStream,
  handleClearSession,
} = require("../controllers/aiController");

const router = express.Router();

// Health check endpoint
router.get("/health", handleHealthCheck);

// PDF upload & indexing
router.post("/uploads", upload.single("pdf"), handleUpload);

// Question answering (supports JSON & multipart)
router.post("/ask", upload.single("pdf"), handleAsk);

// Question answering with real-time SSE streaming
router.post("/ask-stream", upload.single("pdf"), handleAskStream);

// Delete session index from Qdrant
router.post("/clear-session", express.text({ type: "*/*" }), handleClearSession);

module.exports = router;
