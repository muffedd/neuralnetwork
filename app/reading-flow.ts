import type { KnowledgeNode } from "./document-graph";

const READER_STOP_WORDS = new Set(
  "about after also and are because been before being between both but can could does for from has have into its more most not only other over same should such than that the their them then there these they this those through under very was were what when where which while will with would".split(" "),
);

export function splitDocumentText(text: string): string[] {
  const normalized = text.replace(/\r/g, "").replace(/\u0000/g, " ").trim();
  if (!normalized) return [];
  const blocks = normalized
    .replace(/(\[PAGE \d+\])/g, "\n\n$1\n\n")
    .split(/\n{2,}/)
    .map((block) => block.replace(/\n+/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const readingUnits: string[] = [];
  blocks.forEach((block) => {
    if (/^\[PAGE \d+\]$/.test(block)) {
      readingUnits.push(block);
      return;
    }
    const sentences = block.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [block];
    sentences.forEach((sentence) => {
      const words = sentence.trim().split(/\s+/);
      let line = "";
      words.forEach((word) => {
        if (line && `${line} ${word}`.length > 180) {
          readingUnits.push(line);
          line = word;
        } else {
          line = line ? `${line} ${word}` : word;
        }
      });
      if (line) readingUnits.push(line);
    });
  });
  return readingUnits;
}

export function findEvidenceParagraph(node: KnowledgeNode, paragraphs: string[], fallback: number) {
  const source = `${node.label} ${node.evidence || ""} ${node.memoryNote || ""} ${node.note || ""}`
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ");
  const tokens = [...new Set(source.split(/\s+/).filter((token) => token.length > 3 && !READER_STOP_WORDS.has(token)))];
  if (!tokens.length) return fallback;
  let bestIndex = fallback;
  let bestScore = 0;
  paragraphs.forEach((paragraph, index) => {
    if (/^\[PAGE \d+\]$/.test(paragraph)) return;
    const candidate = paragraph.toLowerCase();
    const matches = tokens.filter((token) => candidate.includes(token)).length;
    const score = matches / tokens.length;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  return bestScore >= .12 ? bestIndex : fallback;
}
