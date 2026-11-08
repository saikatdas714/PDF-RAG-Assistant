const fs = require("fs");
const { extractTextFromPDF, chunkText } = require("../services/pdfService");
const { embedContent, generateAnswer } = require("../services/aiService");
const {
  upsertEmbeddings,
  searchSimilar,
  deletePoints,
  clearCollection,
} = require("../services/qdrantService");

/**
 * Health check handler
 */
function handleHealthCheck(req, res) {
  res.send("All Good");
}

/**
 * PDF upload, extraction, embedding, and indexing handler
 */
async function handleUpload(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No PDF file provided" });
    }

    const filePath = req.file.path;
    const originalName = req.file.originalname || "document.pdf";
    const text = await extractTextFromPDF(filePath);
    const chunks = chunkText(text);

    if (chunks.length === 0) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return res.status(400).json({ error: "The PDF does not contain extractable text." });
    }

    const chunkEmbeddings = [];
    for (const chunk of chunks) {
      const embedding = await embedContent(chunk);
      chunkEmbeddings.push({
        text: chunk,
        embedding,
        metadata: {
          documentName: originalName,
          uploadedAt: new Date().toISOString(),
        },
      });
    }

    // Batch upsert into Qdrant and get generated point IDs
    const pointIds = await upsertEmbeddings(chunkEmbeddings);

    // Clean up temporary uploaded file from disk
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // Return JSON response with pointIds and extracted text preview
    res.json({
      success: true,
      message: "Successfully uploaded and indexed into Qdrant",
      pointIds,
      text,
      chunkCount: chunks.length,
    });
  } catch (error) {
    console.error("Error processing PDF upload:", error);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: error.message || "Failed to process PDF" });
  }
}

/**
 * Question answering handler based on indexed PDF context
 */
async function handleAsk(req, res) {
  try {
    const question = req.body.question;
    if (!question) {
      return res.status(400).json({ error: "Missing 'question' in request body" });
    }

    const questionEmbed = await embedContent(question);
    const searchResult = await searchSimilar(questionEmbed, 3);

    const points = searchResult.points || [];
    if (points.length === 0) {
      return res.status(404).json({ error: "No matching context found in vector database" });
    }

    const context = points
      .map((p) => (p.payload && p.payload.text ? p.payload.text : ""))
      .filter((t) => t.length > 0)
      .join("\n\n");

    const answer = await generateAnswer(question, context);

    console.log("Generated Answer:", answer);
    res.json({
      question,
      context,
      answer,
    });
  } catch (error) {
    console.error("Error answering question:", error);
    res.status(500).json({ error: error.message || "Failed to generate answer" });
  }
}

/**
 * Delete generated index/points from Qdrant when session ends
 */
async function handleClearSession(req, res) {
  try {
    let pointIds = req.body ? req.body.pointIds : null;

    // Handle beacon/text format if sent via navigator.sendBeacon
    if (typeof req.body === "string" && req.body.startsWith("{")) {
      try {
        const parsed = JSON.parse(req.body);
        pointIds = parsed.pointIds;
      } catch (e) {}
    }

    if (Array.isArray(pointIds) && pointIds.length > 0) {
      console.log(`Deleting ${pointIds.length} session points from Qdrant...`);
      await deletePoints(pointIds);
      return res.json({ success: true, message: `Deleted ${pointIds.length} session points from Qdrant.` });
    } else {
      console.log("Clearing all indexed points from Qdrant collection...");
      await clearCollection();
      return res.json({ success: true, message: "Cleared all index points from Qdrant collection." });
    }
  } catch (error) {
    console.error("Error clearing Qdrant session index:", error);
    res.status(500).json({ error: error.message || "Failed to clear Qdrant session index" });
  }
}

module.exports = {
  handleHealthCheck,
  handleUpload,
  handleAsk,
  handleClearSession,
};
