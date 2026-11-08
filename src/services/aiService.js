const ai = require("../config/gemini");
const config = require("../config/env");

// Cooldown period (in milliseconds) before retrying a model that previously failed
const MODEL_COOLDOWN_MS = 60 * 1000;
const modelCooldowns = new Map();

// Default request timeout in milliseconds before auto-switching
const REQUEST_TIMEOUT_MS = parseInt(process.env.GEMINI_TIMEOUT_MS, 10) || 10000;

// Runtime mutable priority lists
let activeGenerationModels = [...config.geminiGenerationModels];
let activeEmbeddingModels = [...config.geminiEmbeddingModels];

/**
 * Clean and normalize a model string to ensure it is accepted by Google GenAI SDK
 * (removes quotes, removes leading 'models/' if present, trims whitespace)
 * @param {string} model
 * @returns {string}
 */
function sanitizeModelName(model) {
  if (!model || typeof model !== "string") return "";
  let clean = model.trim().replace(/^['"]|['"]$/g, "");
  if (clean.startsWith("models/")) {
    clean = clean.replace(/^models\//, "");
  }
  return clean;
}

/**
 * Normalizes an array or comma-separated string into a flat array of clean unique model names
 * @param {string[]|string} input
 * @returns {string[]}
 */
function normalizeModelList(input) {
  if (!input) return [];
  const rawList = Array.isArray(input) ? input : String(input).split(",");
  const flat = rawList
    .flatMap((item) => (typeof item === "string" ? item.split(",") : item))
    .map(sanitizeModelName)
    .filter((m) => m.length > 0);

  return [...new Set(flat)];
}

/**
 * Method to manually switch the active generation model at runtime
 * @param {string} newModel - Name of the model to set as active primary
 * @returns {{ success: boolean, activeModel: string, priorityList: string[] }}
 */
function switchModel(newModel) {
  const clean = sanitizeModelName(newModel);
  if (!clean) {
    throw new Error("Invalid model name provided");
  }

  // Place newly selected model at index 0 of the priority list
  activeGenerationModels = [clean, ...activeGenerationModels.filter((m) => m !== clean)];
  // Clear any active cooldown so user can immediately use it
  modelCooldowns.delete(clean);

  console.log(`[ModelSwitcher] ✓ Active generation model switched to '${clean}'.`);
  return {
    success: true,
    activeModel: clean,
    priorityList: [...activeGenerationModels],
  };
}

/**
 * Method to manually switch the active embedding model at runtime
 * @param {string} newModel - Name of the model to set as active embedding primary
 * @returns {{ success: boolean, activeModel: string, priorityList: string[] }}
 */
function switchEmbeddingModel(newModel) {
  const clean = sanitizeModelName(newModel);
  if (!clean) {
    throw new Error("Invalid embedding model name provided");
  }

  activeEmbeddingModels = [clean, ...activeEmbeddingModels.filter((m) => m !== clean)];
  modelCooldowns.delete(clean);

  console.log(`[ModelSwitcher] ✓ Active embedding model switched to '${clean}'.`);
  return {
    success: true,
    activeModel: clean,
    priorityList: [...activeEmbeddingModels],
  };
}

/**
 * Get current active models and cooldown status
 */
function getModelStatus() {
  const now = Date.now();
  const cooldownInfo = {};
  for (const [m, until] of modelCooldowns.entries()) {
    if (until > now) {
      cooldownInfo[m] = `${Math.round((until - now) / 1000)}s cooldown`;
    }
  }

  return {
    activeGenerationModel: activeGenerationModels[0],
    generationPriority: [...activeGenerationModels],
    activeEmbeddingModel: activeEmbeddingModels[0],
    embeddingPriority: [...activeEmbeddingModels],
    cooldowns: cooldownInfo,
  };
}

/**
 * Wraps a promise with a timeout
 * @param {Promise<any>} promise
 * @param {number} ms
 * @param {string} label
 * @returns {Promise<any>}
 */
function withTimeout(promise, ms, label = "Operation") {
  let timerId;
  const timeoutPromise = new Promise((_, reject) => {
    timerId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms / 1000}s`));
    }, ms);
  });

  return Promise.race([
    promise.then((res) => {
      clearTimeout(timerId);
      return res;
    }),
    timeoutPromise,
  ]);
}

/**
 * Extract human-readable error description
 * @param {any} error
 * @returns {string}
 */
function getErrorDetails(error) {
  if (!error) return "Unknown error";
  let msg = error.message || String(error);
  if (typeof msg === "string" && msg.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(msg);
      if (parsed.error?.message) {
        return parsed.error.message.trim();
      }
    } catch (_) {}
  }
  return msg.trim();
}

/**
 * Checks if an error indicates the model is temporarily unavailable or should trigger a fallback
 * @param {any} error
 * @returns {boolean}
 */
function shouldSwitchModel(error) {
  const msg = (error?.message || "").toLowerCase();
  const status = error?.status || error?.code || error?.error?.code;

  return (
    status === 503 ||
    status === 429 ||
    status === 404 ||
    status === 400 ||
    status === 500 ||
    status === 504 ||
    msg.includes("503") ||
    msg.includes("unavailable") ||
    msg.includes("high demand") ||
    msg.includes("exhausted") ||
    msg.includes("rate limit") ||
    msg.includes("no longer available") ||
    msg.includes("not found") ||
    msg.includes("unexpected model name") ||
    msg.includes("timed out") ||
    msg.includes("timeout") ||
    msg.includes("econnreset") ||
    msg.includes("fetch failed")
  );
}

/**
 * Return models sorted so available (non-cooldown) models come first
 * @param {string[]} models
 * @returns {string[]}
 */
function getOrderedCandidates(models) {
  const normalized = normalizeModelList(models);
  const now = Date.now();
  const available = [];
  const inCooldown = [];

  for (const m of normalized) {
    const cooldownUntil = modelCooldowns.get(m) || 0;
    if (now < cooldownUntil) {
      inCooldown.push(m);
    } else {
      available.push(m);
    }
  }

  // If all candidates are in cooldown, try them in their original priority order
  return available.length > 0 ? [...available, ...inCooldown] : [...normalized];
}

/**
 * Mark a model in cooldown
 * @param {string} model
 */
function markModelCooldown(model) {
  const clean = sanitizeModelName(model);
  if (clean) {
    modelCooldowns.set(clean, Date.now() + MODEL_COOLDOWN_MS);
  }
}

/**
 * Clear cooldown when a model succeeds
 * @param {string} model
 */
function markModelSuccess(model) {
  const clean = sanitizeModelName(model);
  if (clean) {
    modelCooldowns.delete(clean);
  }
}

/**
 * Generate embedding vector with automatic fallback
 * @param {string} text
 * @param {string|string[]} [preferredModel]
 * @returns {Promise<number[]>}
 */
async function embedContent(text, preferredModel) {
  const preferredList = normalizeModelList(preferredModel);
  const baseCandidates = preferredList.length > 0
    ? [...preferredList, ...activeEmbeddingModels.filter((m) => !preferredList.includes(m))]
    : activeEmbeddingModels;

  const candidates = getOrderedCandidates(baseCandidates);
  let lastError;

  for (let i = 0; i < candidates.length; i++) {
    const model = candidates[i];
    try {
      const response = await withTimeout(
        ai.models.embedContent({
          model,
          contents: text,
        }),
        REQUEST_TIMEOUT_MS,
        `Embedding with model '${model}'`
      );

      markModelSuccess(model);
      return response.embeddings[0].values;
    } catch (err) {
      lastError = err;
      markModelCooldown(model);
      const nextModel = candidates[i + 1];

      if (nextModel && shouldSwitchModel(err)) {
        console.warn(
          `[AutoModelSwitcher] ⚠️ Embedding model '${model}' unavailable (${getErrorDetails(err)}). Switching to '${nextModel}'...`
        );
        continue;
      }
    }
  }

  throw lastError || new Error("Failed to generate embedding with available models");
}

/**
 * Generate answer using context with automatic model switching
 * @param {string} question
 * @param {string} context
 * @param {string|string[]} [preferredModel]
 * @returns {Promise<{ answer: string, modelUsed: string }>}
 */
async function generateAnswer(question, context, preferredModel) {
  const prompt = `define me ${question} using content${context} give answer less then 50 words`;
  const preferredList = normalizeModelList(preferredModel);
  const baseCandidates = preferredList.length > 0
    ? [...preferredList, ...activeGenerationModels.filter((m) => !preferredList.includes(m))]
    : activeGenerationModels;

  const candidates = getOrderedCandidates(baseCandidates);
  let lastError;

  for (let i = 0; i < candidates.length; i++) {
    const model = candidates[i];
    try {
      console.log(`[AutoModelSwitcher] Attempting answer generation with '${model}'...`);

      const response = await withTimeout(
        ai.models.generateContent({
          model,
          contents: prompt,
        }),
        REQUEST_TIMEOUT_MS,
        `Generation with '${model}'`
      );

      markModelSuccess(model);
      console.log(`[AutoModelSwitcher] ✓ Successfully generated answer using '${model}'.`);
      return {
        answer: response.text,
        modelUsed: model,
      };
    } catch (err) {
      lastError = err;
      markModelCooldown(model);
      const nextModel = candidates[i + 1];

      if (nextModel && shouldSwitchModel(err)) {
        console.warn(
          `[AutoModelSwitcher] ⚠️ Model '${model}' unavailable (${getErrorDetails(err)}). Automatically switching to '${nextModel}'...`
        );
        continue;
      }
    }
  }

  throw lastError || new Error("All configured Gemini models are currently unavailable.");
}

/**
 * Generate streaming answer using context with automatic model switching
 * @param {string} question
 * @param {string} context
 * @param {string|string[]} [preferredModel]
 * @returns {Promise<{ stream: AsyncIterable<any>, modelUsed: string }>}
 */
async function generateAnswerStream(question, context, preferredModel) {
  const prompt = `define me ${question} using content${context} give answer less then 50 words`;
  const preferredList = normalizeModelList(preferredModel);
  const baseCandidates = preferredList.length > 0
    ? [...preferredList, ...activeGenerationModels.filter((m) => !preferredList.includes(m))]
    : activeGenerationModels;

  const candidates = getOrderedCandidates(baseCandidates);
  let lastError;

  for (let i = 0; i < candidates.length; i++) {
    const model = candidates[i];
    try {
      console.log(`[AutoModelSwitcher] Attempting stream generation with '${model}'...`);

      const stream = await withTimeout(
        ai.models.generateContentStream({
          model,
          contents: prompt,
        }),
        REQUEST_TIMEOUT_MS,
        `Stream initiation with '${model}'`
      );

      markModelSuccess(model);
      console.log(`[AutoModelSwitcher] ✓ Successfully opened stream using '${model}'.`);
      return {
        stream,
        modelUsed: model,
      };
    } catch (err) {
      lastError = err;
      markModelCooldown(model);
      const nextModel = candidates[i + 1];

      if (nextModel && shouldSwitchModel(err)) {
        console.warn(
          `[AutoModelSwitcher] ⚠️ Stream model '${model}' unavailable (${getErrorDetails(err)}). Automatically switching to '${nextModel}'...`
        );
        continue;
      }
    }
  }

  throw lastError || new Error("All configured Gemini models are currently unavailable for streaming.");
}

module.exports = {
  embedContent,
  generateAnswer,
  generateAnswerStream,
  switchModel,
  switchEmbeddingModel,
  getModelStatus,
  getOrderedCandidates,
  markModelCooldown,
  markModelSuccess,
  getErrorDetails,
  sanitizeModelName,
  normalizeModelList,
};
