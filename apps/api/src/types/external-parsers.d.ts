declare module "pdf-parse" {
  function pdfParse(data: Buffer, options?: Record<string, unknown>): Promise<{ text: string; numpages: number }>;
  export = pdfParse;
}
declare module "word-extractor" {
  class WordExtractor {
    extract(data: Buffer): Promise<{ getBody(): string }>;
  }
  export = WordExtractor;
}
