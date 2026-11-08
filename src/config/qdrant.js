const { QdrantClient } = require("@qdrant/js-client-rest");
const config = require("./env");

const qdrantClient = new QdrantClient({
  url: config.qdrantUrl,
  apiKey: config.qdrantApiKey,
});

module.exports = qdrantClient;
