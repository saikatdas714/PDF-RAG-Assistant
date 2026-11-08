const ai = require("../config/gemini");
const config = require("../config/env");

// Cooldown period (in milliseconds) before retrying a model that previously failed
const MODEL_COOLDOWN_MS = 60 * 1000;
const modelCooldowns = new Map();

// Default request timeout in milliseconds before auto-switching
const REQUEST_TIMEOUT_MS = parseInt(process.env.GEMINI_TIMEOUT_MS, 10) || 10000;

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
        return parsed.error.message;
      }
    } catch (_) {}
  }
  return msg;
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
    status === 500 ||
    status === 504 ||
    msg.includes("503") ||
    msg.includes("unavailable") ||
    msg.includes("high demand") ||
    msg.includes("exhausted") ||
    msg.includes("rate limit") ||
    msg.includes("no longer available") ||
    msg.includes("not found") ||
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
  const now = Date.now();
  const available = [];
  const inCooldown = [];

  for (const m of models) {
    const cooldownUntil = modelCooldowns.get(m) || 0;
    if (now < cooldownUntil) {
      inCooldown.push(m);
    } else {
      available.push(m);
    }
  }

  // If all candidates are in cooldown, try them in their original priority order
  return available.length > 0 ? [...available, ...inCooldown] : [...models];
}

/**
 * Mark a model in cooldown
 * @param {string} model
 */
function markModelCooldown(model) {
  modelCooldowns.set(model, Date.now() + MODEL_COOLDOWN_MS);
}

/**
 * Clear cooldown when a model succeeds
 * @param {string} model
 */
function markModelSuccess(model) {
  modelCooldowns.delete(model);
}

/**
 * Generate embedding vector with automatic fallback
 * @param {string} text
 * @param {string} [preferredModel]
 * @returns {Promise<number[]>}
 */
async function embedContent(text, preferredModel) {
  const baseCandidates = preferredModel
    ? [preferredModel, ...config.geminiEmbeddingModels.filter((m) => m !== preferredModel)]
    : config.geminiEmbeddingModels;

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
 * @param {string} [preferredModel]
 * @returns {Promise<{ answer: string, modelUsed: string }>}
 */
async function generateAnswer(question, context, preferredModel) {
  const prompt = `define me ${question} using content${context} give answer less then 50 words`;
  const baseCandidates = preferredModel
    ? [preferredModel, ...config.geminiGenerationModels.filter((m) => m !== preferredModel)]
    : config.geminiGenerationModels;

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
 * @param {string} [preferredModel]
 * @returns {Promise<{ stream: AsyncIterable<any>, modelUsed: string }>}
 */
async function generateAnswerStream(question, context, preferredModel) {
  const prompt = `define me ${question} using content${context} give answer less then 50 words`;
  const baseCandidates = preferredModel
    ? [preferredModel, ...config.geminiGenerationModels.filter((m) => m !== preferredModel)]
    : config.geminiGenerationModels;

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
  getOrderedCandidates,
  markModelCooldown,
  markModelSuccess,
  getErrorDetails,
};
