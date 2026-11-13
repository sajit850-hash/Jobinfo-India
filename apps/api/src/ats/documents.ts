import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import WordExtractor = require("word-extractor");

export async function extractJobDescription(bytes: Buffer, fileName: string) {
  const extension = fileName.toLowerCase().split(".").pop();
  let text = "";
  if (extension === "pdf") text = (await pdfParse(bytes)).text;
  else if (extension === "docx") text = (await mammoth.extractRawText({ buffer: bytes })).value;
  else if (extension === "doc") text = (await new WordExtractor().extract(bytes)).getBody();
  else throw new Error("Upload a PDF, DOC or DOCX job description.");
  const normalized = text.replace(/\u0000/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (normalized.length < 30) throw new Error("Could not extract enough readable text from this job description.");
  return normalized.slice(0, 50000);
}
