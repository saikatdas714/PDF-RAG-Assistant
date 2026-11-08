const crypto = require("crypto");
const qdrantClient = require("../config/qdrant");
const config = require("../config/env");

/**
 * Upsert embedded chunks into Qdrant vector database in a single fast batch
 * @param {Array<{ text: string, embedding: number[], metadata?: object }>} chunkEmbeddings
 * @param {string} [collectionName]
 * @returns {Promise<string[]>} Array of generated point IDs
 */
async function upsertEmbeddings(chunkEmbeddings, collectionName = config.qdrantCollection) {
  if (!chunkEmbeddings || chunkEmbeddings.length === 0) return [];

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
        ...(item.metadata || {}),
      },
    };
  });

  // Perform single batch upsert
  await qdrantClient.upsert(collectionName, {
    points,
  });

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
 * @param {string} [collectionName]
 */
async function clearCollection(collectionName = config.qdrantCollection) {
  return await qdrantClient.delete(collectionName, {
    filter: {},
  });
}

module.exports = {
  upsertEmbeddings,
  searchSimilar,
  deletePoints,
  clearCollection,
};
