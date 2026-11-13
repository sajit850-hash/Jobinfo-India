import sanitizeHtml from "sanitize-html";

const fontFamily = /^(Arial|Georgia|Tahoma|['"]?Times New Roman['"]?|Verdana|sans-serif|serif)(\s*,\s*(Arial|Georgia|Tahoma|['"]?Times New Roman['"]?|Verdana|sans-serif|serif))*$/i;
const color = /^#[\da-f]{3,8}$/i;

const jobDescriptionOptions: sanitizeHtml.IOptions = {
  allowedTags: ["p", "br", "strong", "b", "em", "i", "u", "s", "strike", "del", "ul", "ol", "li", "a", "span", "h1", "h2", "h3", "h4", "blockquote"],
  allowedAttributes: {
    a: ["href", "target", "rel"],
    p: ["style"],
    span: ["style"],
    h1: ["style"], h2: ["style"], h3: ["style"], h4: ["style"],
  },
  allowedStyles: {
    "*": {
      "text-align": [/^(left|center|right|justify)$/],
      "font-family": [fontFamily],
      "font-size": [/^(12|14|16|18|24|32)px$/],
      "margin-left": [/^(24|48|72|96)px$/],
      color: [color],
      "background-color": [color],
    },
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesAppliedToAttributes: ["href"],
  disallowedTagsMode: "discard",
  transformTags: {
    a: (_tagName, attributes) => ({
      tagName: "a",
      attribs: {
        ...attributes,
        ...(attributes.target === "_blank" ? { rel: "noopener noreferrer" } : {}),
      },
    }),
  },
};

export function sanitizeJobDescriptionHtml(value: unknown): string {
  const input = typeof value === "string" ? value : "";
  if (!input.trim()) return "<p></p>";
  const hasMarkup = /<\/?[a-z][^>]*>/i.test(input);
  const source = hasMarkup ? input : `<p>${input.replace(/\r?\n/g, "<br>")}</p>`;
  return sanitizeHtml(source, jobDescriptionOptions);
}

export function jobDescriptionPlainText(value: unknown): string {
  return sanitizeHtml(sanitizeJobDescriptionHtml(value), { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/gi, " ")
    .replace(/&#x([\da-f]+);/gi, (_match, hex: string) => decodeEntity(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal: string) => decodeEntity(Number(decimal)))
    .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ").trim();
}

function decodeEntity(codePoint: number) {
  return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff && !(codePoint >= 0xd800 && codePoint <= 0xdfff)
    ? String.fromCodePoint(codePoint)
    : " ";
}

export function sanitizeJobDraftData(value: Record<string, unknown>): Record<string, unknown> {
  const description = value.description;
  if (!description || typeof description !== "object" || Array.isArray(description)) return value;
  const current = description as Record<string, unknown>;
  return { ...value, description: { ...current, overview: sanitizeJobDescriptionHtml(current.overview) } };
}
