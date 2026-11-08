const { GoogleGenAI } = require("@google/genai");
const config = require("./env");

const ai = new GoogleGenAI({
  apiKey: config.geminiApiKey,
});

module.exports = ai;
