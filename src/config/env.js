require("dotenv").config();

/**
 * Parses comma-separated model strings or returns default array
 * @param {string|undefined} envValue
 * @param {string[]} defaultList
 * @returns {string[]}
 */
function parseModelList(envValue, defaultList) {
  if (!envValue) return defaultList;
  const list = envValue
    .split(",")
    .map((m) => m.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
  return list.length > 0 ? list : defaultList;
}

const defaultGenerationModels = [
  "gemini-3.8-flash",
  "gemini-3.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-3.1-flash-lite",
];

const defaultEmbeddingModels = [
  "gemini-embedding-2",
  "gemini-embedding-001",
];

const rawGenModel = (process.env.GEMINI_GENERATION_MODEL || defaultGenerationModels[0])
  .split(",")[0]
  .trim()
  .replace(/^['"]|['"]$/g, "");

const rawEmbedModel = (process.env.GEMINI_EMBEDDING_MODEL || defaultEmbeddingModels[0])
  .split(",")[0]
  .trim()
  .replace(/^['"]|['"]$/g, "");

const config = {
  port: process.env.PORT || 3000,
  geminiApiKey: process.env.GEMINI_API_KEY,
  geminiEmbeddingModel: rawEmbedModel,
  geminiEmbeddingModels: parseModelList(
    process.env.GEMINI_EMBEDDING_MODELS || process.env.GEMINI_EMBEDDING_MODEL,
    defaultEmbeddingModels
  ),
  geminiGenerationModel: rawGenModel,
  geminiGenerationModels: parseModelList(
    process.env.GEMINI_GENERATION_MODELS || process.env.GEMINI_GENERATION_MODEL,
    defaultGenerationModels
  ),
  qdrantUrl: process.env.QDRANT_URL,
  qdrantApiKey: process.env.QDRANT_API_KEY,
  qdrantCollection: process.env.QDRANT_COLLECTION || "pdf_embed",
  qdrantAutoDeleteMinutes: parseInt(process.env.QDRANT_AUTO_DELETE_MINUTES, 10) || 5,
};

module.exports = config;
