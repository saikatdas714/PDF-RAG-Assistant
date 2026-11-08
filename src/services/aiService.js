const ai = require("../config/gemini");
const config = require("../config/env");

/**
 * Generate embedding vector for the given text using Gemini
 * @param {string} text
 * @param {string} [model]
 * @returns {Promise<number[]>}
 */
async function embedContent(text, model = config.geminiEmbeddingModel) {
  const response = await ai.models.embedContent({
    model,
    contents: text,
  });
  return response.embeddings[0].values;
}

/**
 * Generate answer using context and Gemini model
 * @param {string} question
 * @param {string} context
 * @param {string} [model]
 * @returns {Promise<string>}
 */
async function generateAnswer(question, context, model = config.geminiGenerationModel) {
  const prompt = `define me ${question} using content${context} give answer less then 50 words`;
  const response = await ai.models.generateContent({
    model,
    contents: prompt,
  });
  return response.text;
}

module.exports = {
  embedContent,
  generateAnswer,
};
