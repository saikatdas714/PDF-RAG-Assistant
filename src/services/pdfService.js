const fs = require("fs");

// Polyfill DOMMatrix for Node.js / Serverless environments if needed
if (typeof globalThis.DOMMatrix === "undefined") {
  class DOMMatrixPolyfill {
    constructor() {
      this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0;
      this.m11 = 1; this.m12 = 0; this.m13 = 0; this.m14 = 0;
      this.m21 = 0; this.m22 = 1; this.m23 = 0; this.m24 = 0;
      this.m31 = 0; this.m32 = 0; this.m33 = 1; this.m34 = 0;
      this.m41 = 0; this.m42 = 0; this.m43 = 0; this.m44 = 1;
      this.is2D = true;
      this.isIdentity = true;
    }
    static fromMatrix(o) { return new DOMMatrixPolyfill(); }
    static fromFloat32Array(a) { return new DOMMatrixPolyfill(); }
    static fromFloat64Array(a) { return new DOMMatrixPolyfill(); }
    multiply(o) { return this; }
    translate(tx, ty) { return this; }
    scale(sx, sy) { return this; }
    rotate(deg) { return this; }
    transformPoint(p) { return p; }
    inverse() { return this; }
  }
  globalThis.DOMMatrix = DOMMatrixPolyfill;
  globalThis.DOMMatrixReadOnly = DOMMatrixPolyfill;
}

/**
 * Extract text content from a PDF Buffer or file path
 * Works seamlessly with both pdf-parse v1 (pure JS) and v2
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

  let pdfModule;
  try {
    pdfModule = require("pdf-parse");
  } catch (err) {
    console.error("Failed to require pdf-parse:", err);
    throw new Error("PDF parser dependency failed to load: " + err.message);
  }

  // 1. pdf-parse v1 (pure JavaScript function: pdf(buffer))
  if (typeof pdfModule === "function") {
    const data = await pdfModule(buffer);
    return data && data.text ? data.text : "";
  }

  // 2. pdf-parse v2 (class syntax: new PDFParse({ data: buffer }))
  const ParserClass = pdfModule.PDFParse || pdfModule;
  if (typeof ParserClass === "function") {
    const parser = new ParserClass({ data: buffer });
    if (typeof parser.getText === "function") {
      const data = await parser.getText();
      return data && data.text ? data.text : "";
    }
  }

  throw new Error("Unsupported pdf-parse module format");
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
