const fs = require("fs");

let PDFParseClass = null;

function getPDFParser() {
  if (!PDFParseClass) {
    try {
      const pdfModule = require("pdf-parse");
      PDFParseClass = pdfModule.PDFParse || pdfModule;
    } catch (err) {
      console.error("Failed to load pdf-parse:", err);
      throw new Error("PDF parser dependency failed to load: " + err.message);
    }
  }
  return PDFParseClass;
}

/**
 * Extract text content from a PDF Buffer or file path
 * @param {Buffer | string} input
 * @returns {Promise<string>}
 */
async function extractTextFromPDF(input) {
  let buffer;
  if (Buffer.isBuffer(input)) {
    buffer = input;
  } else if (typeof input === "string") {
    buffer = fs.readFileSync(input);
  } else {
    throw new Error("Invalid PDF input: expected a Buffer or file path");
  }

  const Parser = getPDFParser();
  const parser = new Parser({ data: buffer });
  const data = await parser.getText();
  return data.text || "";
}

/**
 * Chunk extracted text into coherent semantic segments
 * Groups lines and paragraphs up to maxChunkSize for optimal embedding accuracy
 * @param {string} text
 * @param {number} [maxChunkSize=500]
 * @returns {string[]}
 */
function chunkText(text, maxChunkSize = 500) {
  if (!text) return [];

  const rawSegments = text
    .split(/\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const chunks = [];
  let currentChunk = "";

  for (const segment of rawSegments) {
    if ((currentChunk + " " + segment).length <= maxChunkSize) {
      currentChunk = currentChunk ? currentChunk + "\n" + segment : segment;
    } else {
      if (currentChunk) chunks.push(currentChunk);
      if (segment.length > maxChunkSize) {
        for (let i = 0; i < segment.length; i += maxChunkSize) {
          chunks.push(segment.slice(i, i + maxChunkSize));
        }
        currentChunk = "";
      } else {
        currentChunk = segment;
      }
    }
  }

  if (currentChunk && !chunks.includes(currentChunk)) {
    chunks.push(currentChunk);
  }

  return chunks.length > 0 ? chunks : rawSegments;
}

module.exports = {
  extractTextFromPDF,
  chunkText,
};
