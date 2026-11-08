const express = require("express");
const path = require("path");
const config = require("./src/config/env");
const aiRoutes = require("./src/routes/aiRoutes");
const { clearCollection } = require("./src/services/qdrantService");

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend UI from public/
app.use(express.static(path.join(__dirname, "public")));

// Register API routes
app.use("/", aiRoutes);

// Global error handler
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: err.message || "Internal Server Error" });
});

const server = app.listen(config.port, () => {
  console.log(`Server is running at http://localhost:${config.port}`);
});

// Clean up Qdrant index on process termination / session end
async function cleanupAndExit(signal) {
  console.log(`\n[${signal}] Session ending. Cleaning up generated Qdrant index...`);
  try {
    await clearCollection();
    console.log("✓ Successfully deleted Qdrant index points.");
  } catch (err) {
    console.error("Failed to delete Qdrant index on exit:", err.message);
  } finally {
    server.close(() => {
      process.exit(0);
    });
  }
}

process.on("SIGINT", () => cleanupAndExit("SIGINT"));
process.on("SIGTERM", () => cleanupAndExit("SIGTERM"));

module.exports = app;
