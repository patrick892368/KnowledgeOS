export interface ChunkTextOptions {
  maxCharacters?: number;
}

const defaultMaxCharacters = 1600;

export function estimateTokenCount(text: string): number {
  const normalized = text.trim();
  return normalized.length === 0 ? 0 : Math.max(1, Math.ceil(normalized.length / 4));
}

function splitLongParagraph(paragraph: string, maxCharacters: number): string[] {
  const words = paragraph.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current.length === 0 ? word : `${current} ${word}`;

    if (next.length <= maxCharacters) {
      current = next;
      continue;
    }

    if (current.length > 0) {
      chunks.push(current);
    }

    current = word;
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

export function chunkText(
  content: string,
  options: ChunkTextOptions = {}
): string[] {
  const maxCharacters = options.maxCharacters ?? defaultMaxCharacters;
  const paragraphs = content
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const parts =
      paragraph.length > maxCharacters
        ? splitLongParagraph(paragraph, maxCharacters)
        : [paragraph];

    for (const part of parts) {
      const next = current.length === 0 ? part : `${current}\n\n${part}`;

      if (next.length <= maxCharacters) {
        current = next;
        continue;
      }

      if (current.length > 0) {
        chunks.push(current);
      }

      current = part;
    }
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}
