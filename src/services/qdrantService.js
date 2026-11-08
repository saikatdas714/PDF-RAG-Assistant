const crypto = require("crypto");
const qdrantClient = require("../config/qdrant");
const config = require("../config/env");

let autoDeleteTimer = null;
let autoDeleteExpiresAt = null;

/**
 * Schedule automatic deletion of all vectors from Qdrant after a given duration
 * @param {number} [minutes] - Duration in minutes (defaults to config.qdrantAutoDeleteMinutes)
 * @param {string} [collectionName]
 */
function scheduleAutoDelete(minutes = config.qdrantAutoDeleteMinutes, collectionName = config.qdrantCollection) {
  cancelAutoDeleteTimer();

  const delayMs = Math.round((minutes || config.qdrantAutoDeleteMinutes) * 60 * 1000);
  autoDeleteExpiresAt = Date.now() + delayMs;

  console.log(
    `[Qdrant AutoDelete] ⏱️ Scheduled auto-deletion of all vectors in ${minutes} minute(s) (at ${new Date(autoDeleteExpiresAt).toLocaleTimeString()}).`
  );

  autoDeleteTimer = setTimeout(async () => {
    console.log(
      `[Qdrant AutoDelete] ⏰ ${minutes} minute(s) elapsed. Automatically deleting all vectors from Qdrant collection '${collectionName}'...`
    );
    try {
      await clearCollection(collectionName);
      console.log(`[Qdrant AutoDelete] ✓ Successfully deleted all vectors from Qdrant after ${minutes} minute(s).`);
    } catch (err) {
      console.error(`[Qdrant AutoDelete] ❌ Failed to auto-delete vectors:`, err.message);
    } finally {
      autoDeleteTimer = null;
      autoDeleteExpiresAt = null;
    }
  }, delayMs);

  // Allow process to terminate cleanly without timer blocking
  if (autoDeleteTimer.unref) {
    autoDeleteTimer.unref();
  }
}

/**
 * Cancel any pending auto-deletion timer
 */
function cancelAutoDeleteTimer() {
  if (autoDeleteTimer) {
    clearTimeout(autoDeleteTimer);
    autoDeleteTimer = null;
    autoDeleteExpiresAt = null;
    console.log("[Qdrant AutoDelete] Auto-delete timer reset / cancelled.");
  }
}

/**
 * Get status of auto-delete timer
 */
function getAutoDeleteStatus() {
  const now = Date.now();
  const remainingMs = autoDeleteExpiresAt ? Math.max(0, autoDeleteExpiresAt - now) : 0;
  return {
    isScheduled: !!autoDeleteTimer,
    secondsRemaining: Math.round(remainingMs / 1000),
    expiresAt: autoDeleteExpiresAt ? new Date(autoDeleteExpiresAt).toISOString() : null,
  };
}

/**
 * Upsert embedded chunks into Qdrant vector database in a single fast batch
 * Automatically triggers the 5-minute auto-deletion timer
 * @param {Array<{ text: string, embedding: number[], metadata?: object }>} chunkEmbeddings
 * @param {string} [collectionName]
 * @returns {Promise<string[]>} Array of generated point IDs
 */
async function upsertEmbeddings(chunkEmbeddings, collectionName = config.qdrantCollection) {
  if (!chunkEmbeddings || chunkEmbeddings.length === 0) return [];

  const now = Date.now();
  const pointIds = [];
  const points = chunkEmbeddings.map((item, index) => {
    const id = crypto.randomUUID();
    pointIds.push(id);
    return {
      id,
      vector: item.embedding,
      payload: {
        text: item.text,
        chunkIndex: index,
        createdAt: now,
        ...(item.metadata || {}),
      },
    };
  });

  // Perform single batch upsert
  await qdrantClient.upsert(collectionName, {
    points,
  });

  // Schedule auto-deletion of all vectors after 5 minutes
  scheduleAutoDelete(config.qdrantAutoDeleteMinutes, collectionName);

  return pointIds;
}

/**
 * Search most similar vectors in Qdrant
 * @param {number[]} vector
 * @param {number} [limit=3]
 * @param {string} [collectionName]
 * @returns {Promise<any>}
 */
async function searchSimilar(vector, limit = 3, collectionName = config.qdrantCollection) {
  const result = await qdrantClient.query(collectionName, {
    query: vector,
    limit,
    with_payload: true,
  });
  return result;
}

/**
 * Delete specific points from Qdrant by their IDs
 * @param {string[]} pointIds
 * @param {string} [collectionName]
 */
async function deletePoints(pointIds, collectionName = config.qdrantCollection) {
  if (!pointIds || pointIds.length === 0) return;
  return await qdrantClient.delete(collectionName, {
    points: pointIds,
  });
}

/**
 * Delete all indexed points in the collection (clears index)
 * Also cancels any pending auto-delete timer
 * @param {string} [collectionName]
 */
async function clearCollection(collectionName = config.qdrantCollection) {
  cancelAutoDeleteTimer();
  return await qdrantClient.delete(collectionName, {
    filter: {},
  });
}

/**
 * Get total number of points in the Qdrant collection
 * @param {string} [collectionName]
 * @returns {Promise<number>}
 */
async function getPointsCount(collectionName = config.qdrantCollection) {
  try {
    const info = await qdrantClient.getCollection(collectionName);
    return info.points_count || 0;
  } catch (err) {
    return 0;
  }
}

module.exports = {
  upsertEmbeddings,
  searchSimilar,
  deletePoints,
  clearCollection,
  scheduleAutoDelete,
  cancelAutoDeleteTimer,
  getAutoDeleteStatus,
  getPointsCount,
};
