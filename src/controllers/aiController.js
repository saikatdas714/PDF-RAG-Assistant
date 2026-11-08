const fs = require("fs");
const { extractTextFromPDF, chunkText } = require("../services/pdfService");
const {
  embedContent,
  generateAnswer,
  generateAnswerStream,
  switchModel,
  switchEmbeddingModel,
  getModelStatus,
  getErrorDetails,
} = require("../services/aiService");
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

    // Support both memory buffer (serverless/Vercel) and disk path (local)
    const fileData = req.file.buffer || (req.file.path ? fs.readFileSync(req.file.path) : null);
    if (!fileData) {
      return res.status(400).json({ error: "Could not read uploaded PDF file buffer" });
    }

    const originalName = req.file.originalname || "document.pdf";
    const text = await extractTextFromPDF(fileData);
    const chunks = chunkText(text);

    if (chunks.length === 0) {
      if (req.file.path && fs.existsSync(req.file.path)) {
        try { fs.unlinkSync(req.file.path); } catch (e) {}
      }
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

    // Clean up temporary disk file if one was written
    if (req.file.path && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
    }

    res.json({
      success: true,
      message: "Successfully uploaded and indexed into Qdrant",
      pointIds,
      text,
      chunkCount: chunks.length,
    });
  } catch (error) {
    console.error("Error processing PDF upload:", error);
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
    }
    res.status(500).json({ error: getErrorDetails(error) || "Failed to process PDF" });
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

    const requestedModel = req.body.model;
    const result = await generateAnswer(question, context, requestedModel);
    const answer = typeof result === "string" ? result : result.answer;
    const modelUsed = result?.modelUsed || requestedModel || "gemini";

    console.log(`Generated Answer (via ${modelUsed}):`, answer);
    res.json({
      question,
      context,
      answer,
      modelUsed,
    });
  } catch (error) {
    console.error("Error answering question:", error);
    res.status(500).json({ error: getErrorDetails(error) || "Failed to generate answer" });
  }
}

/**
 * Real-time SSE streaming question answering handler
 */
async function handleAskStream(req, res) {
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

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    if (res.flushHeaders) res.flushHeaders();

    // 1. Send matched context first
    res.write(`event: context\ndata: ${JSON.stringify({ context })}\n\n`);

    // 2. Stream generation chunks from Gemini
    const requestedModel = req.body.model;
    const streamResult = await generateAnswerStream(question, context, requestedModel);
    const stream = streamResult?.stream || streamResult;
    const modelUsed = streamResult?.modelUsed || requestedModel || "gemini";

    res.write(`event: model\ndata: ${JSON.stringify({ modelUsed })}\n\n`);

    for await (const chunk of stream) {
      if (chunk.text) {
        res.write(`event: chunk\ndata: ${JSON.stringify({ text: chunk.text })}\n\n`);
      }
    }

    // 3. Send done event
    res.write(`event: done\ndata: ${JSON.stringify({ modelUsed })}\n\n`);
    res.end();
  } catch (error) {
    console.error("Error in streaming response:", error);
    const friendlyError = getErrorDetails(error) || "Failed to stream answer";
    if (!res.headersSent) {
      res.status(500).json({ error: friendlyError });
    } else {
      res.write(`event: error\ndata: ${JSON.stringify({ error: friendlyError })}\n\n`);
      res.end();
    }
  }
}

/**
 * Delete generated index/points from Qdrant when session ends
 */
async function handleClearSession(req, res) {
  try {
    let pointIds = req.body ? req.body.pointIds : null;

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

/**
 * Get active and available models status
 */
function handleGetModels(req, res) {
  try {
    const status = getModelStatus();
    res.json({
      success: true,
      ...status,
    });
  } catch (error) {
    res.status(500).json({ error: getErrorDetails(error) });
  }
}

/**
 * Switch active model at runtime
 */
function handleSwitchModel(req, res) {
  try {
    const { model, embeddingModel } = req.body || {};
    let result = {};

    if (model) {
      result = switchModel(model);
    }
    if (embeddingModel) {
      result.embedding = switchEmbeddingModel(embeddingModel);
    }

    if (!model && !embeddingModel) {
      return res.status(400).json({ error: "Missing 'model' or 'embeddingModel' in request body" });
    }

    res.json({
      success: true,
      message: model ? `Successfully switched active generation model to '${result.activeModel}'` : "Switched embedding model",
      ...getModelStatus(),
    });
  } catch (error) {
    console.error("Error switching model:", error);
    res.status(400).json({ error: getErrorDetails(error) });
  }
}

module.exports = {
  handleHealthCheck,
  handleUpload,
  handleAsk,
  handleAskStream,
  handleClearSession,
  handleGetModels,
  handleSwitchModel,
};
