export type NodeKind = "topic" | "branch" | "concept" | "bridge";

export type KnowledgeNode = {
  id: string;
  label: string;
  kind: NodeKind;
  x: number;
  y: number;
  z: number;
  note: string;
  memoryNote?: string;
  evidence?: string;
  mentions?: number;
};

export type KnowledgeEdge = {
  from: string;
  to: string;
  relation: "contains" | "shared" | "related" | "part-of" | "depends-on" | "produces" | "uses" | "causes" | "contrasts" | "sequence";
};

export type KnowledgeGraph = {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  title: string;
  sectionCount: number;
  sharedCount: number;
  semanticCount?: number;
  wordCount: number;
};

export type DocumentOutline = {
  title: string;
  sections: Array<{
    id: string;
    name: string;
    evidence: string;
  }>;
  concepts: Array<{
    id: string;
    name: string;
    aliases: string[];
    evidence: string;
    memoryNote: string;
    sectionIds: string[];
  }>;
  semanticLinks: Array<{
    sourceId: string;
    targetId: string;
    relationship: "related" | "part-of" | "depends-on" | "produces" | "uses" | "causes" | "contrasts" | "sequence";
    evidence: string;
  }>;
};

const STOP = new Set(
  "about above after again against also among and are because been before being between both but can could did does doing down during each few for from further had has have having here how into its itself just more most much must not now off once only other our out over own same should some such than that the their theirs them themselves then there these they this those through too under until very was were what when where which while who why will with would your using used use into onto upon within without figure table chapter section example introduction summary conclusion result results".split(" "),
);

const clean = (value: string) =>
  value
    .replace(/\s+/g, " ")
    .replace(/^[\d\s.()[\]_-]+/, "")
    .replace(/[:;,.]+$/, "")
    .trim();

const key = (value: string) =>
  clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .split(/\s+/)
    .map((word) => (word.length > 4 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word))
    .join("-");

const hash = (value: string) => {
  let result = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    result ^= value.charCodeAt(i);
    result = Math.imul(result, 16777619);
  }
  return Math.abs(result);
};

const isHeading = (line: string, previousBlank: boolean, nextBlank: boolean) => {
  const value = clean(line);
  if (value.length < 3 || value.length > 86) return false;
  if (/^[•·-]/.test(line) || /[.!?]$/.test(value)) return false;
  const words = value.split(/\s+/);
  if (words.length > 11) return false;
  const numbered = /^(?:chapter\s+)?(?:\d+(?:\.\d+)*|[IVXLC]+)[\s:.-]+/i.test(line.trim());
  const upper = value.length > 4 && value === value.toUpperCase() && /[A-Z]/.test(value);
  const titleWords = words.filter((word) => /^[A-Z][A-Za-z-]+$/.test(word)).length;
  return numbered || upper || (previousBlank && nextBlank && titleWords >= Math.max(1, Math.ceil(words.length * .55)));
};

const termCandidates = (content: string, heading: string) => {
  const words = content
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .match(/[a-z][a-z-]{2,}/g) ?? [];
  const counts = new Map<string, number>();
  words.forEach((word) => {
    if (word.length < 4 || STOP.has(word)) return;
    const normalized = word.length > 5 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  });

  const headingWords = new Set(key(heading).split("-"));
  return [...counts]
    .filter(([word]) => !headingWords.has(word))
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, 5)
    .map(([word, mentions]) => ({ label: word.replace(/\b\w/g, (letter) => letter.toUpperCase()), mentions }));
};

export function buildGraphFromText(rawText: string, fallbackTitle: string): KnowledgeGraph {
  const normalized = rawText.replace(/\r/g, "").replace(/\u0000/g, " ");
  const lines = normalized.split("\n").map((line) => line.trim());
  const meaningful = lines.filter(Boolean);
  const title = clean(meaningful[0] || fallbackTitle.replace(/\.[^.]+$/, "")) || "Document";
  const sections: { heading: string; content: string[] }[] = [];
  let active: { heading: string; content: string[] } | null = null;

  lines.forEach((line, index) => {
    if (!line) return;
    const heading = isHeading(line, index === 0 || !lines[index - 1], index === lines.length - 1 || !lines[index + 1]);
    if (heading && clean(line).toLowerCase() !== title.toLowerCase()) {
      active = { heading: clean(line), content: [] };
      sections.push(active);
    } else {
      if (!active) {
        active = { heading: title, content: [] };
        sections.push(active);
      }
      active.content.push(line);
    }
  });

  let useful = sections
    .filter((section) => section.content.join(" ").length > 50)
    .slice(0, 10);

  if (useful.length < 2) {
    useful = normalized
      .split(/\n\s*\n|(?<=[.!?])\s+(?=[A-Z][A-Za-z ]{3,50}:)/)
      .map((paragraph, index) => ({
        heading: clean(paragraph.split(/[.!?]/)[0]).split(/\s+/).slice(0, 7).join(" ") || `Section ${index + 1}`,
        content: [paragraph],
      }))
      .filter((section) => section.content[0].length > 70)
      .slice(0, 8);
  }

  if (!useful.length) useful = [{ heading: title, content: [normalized] }];

  const nodes: KnowledgeNode[] = [{
    id: "topic",
    label: title.slice(0, 64),
    kind: "topic",
    x: 0,
    y: 0,
    z: 0,
    note: "Central topic identified from the document.",
  }];
  const edges: KnowledgeEdge[] = [];
  const conceptNodes = new Map<string, KnowledgeNode>();
  const conceptParents = new Map<string, Set<string>>();

  useful.forEach((section, index) => {
    const angle = (index / useful.length) * Math.PI * 2 - Math.PI / 2;
    const branchId = `section-${index}`;
    const radius = 285 + (index % 2) * 45;
    nodes.push({
      id: branchId,
      label: section.heading.slice(0, 56),
      kind: "branch",
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius * .72,
      z: ((hash(section.heading) % 180) - 90),
      note: "Section or major subtopic detected from the document structure.",
    });
    edges.push({ from: "topic", to: branchId, relation: "contains" });

    termCandidates(section.content.join(" "), section.heading).forEach((term, termIndex) => {
      const conceptKey = key(term.label);
      if (!conceptKey) return;
      const conceptId = `concept-${conceptKey}`;
      if (!conceptNodes.has(conceptKey)) {
        const spread = 115 + termIndex * 24;
        const node: KnowledgeNode = {
          id: conceptId,
          label: term.label,
          kind: "concept",
          x: Math.cos(angle) * (radius + spread) + Math.cos(angle + Math.PI / 2) * (termIndex - 2) * 27,
          y: Math.sin(angle) * (radius + spread) * .72 + Math.sin(angle + Math.PI / 2) * (termIndex - 2) * 27,
          z: ((hash(conceptKey) % 260) - 130),
          note: `Important term found ${term.mentions} time${term.mentions === 1 ? "" : "s"} in this section.`,
          mentions: term.mentions,
        };
        conceptNodes.set(conceptKey, node);
        nodes.push(node);
      } else {
        const node = conceptNodes.get(conceptKey)!;
        node.mentions = (node.mentions ?? 0) + term.mentions;
      }
      const parents = conceptParents.get(conceptKey) ?? new Set<string>();
      parents.add(branchId);
      conceptParents.set(conceptKey, parents);
      if (!edges.some((edge) => edge.from === branchId && edge.to === conceptId)) {
        edges.push({ from: branchId, to: conceptId, relation: "contains" });
      }
    });
  });

  conceptParents.forEach((parents, conceptKey) => {
    if (parents.size < 2) return;
    const node = conceptNodes.get(conceptKey);
    if (node) {
      node.kind = "bridge";
      node.note = `Shared concept found in ${parents.size} document sections. Kept as one canonical node.`;
      const parentNodes = [...parents].map((id) => nodes.find((item) => item.id === id)).filter(Boolean) as KnowledgeNode[];
      node.x = parentNodes.reduce((sum, item) => sum + item.x, 0) / parentNodes.length;
      node.y = parentNodes.reduce((sum, item) => sum + item.y, 0) / parentNodes.length;
      node.z = -50;
      edges.forEach((edge) => {
        if (edge.to === node.id) edge.relation = "shared";
      });
    }
  });

  return {
    nodes,
    edges,
    title,
    sectionCount: useful.length,
    sharedCount: [...conceptParents.values()].filter((parents) => parents.size > 1).length,
    wordCount: normalized.trim().split(/\s+/).filter(Boolean).length,
  };
}

export function buildGraphFromOutline(outline: DocumentOutline, wordCount: number): KnowledgeGraph {
  const sections = (outline.sections ?? []).filter((section) => section.id && section.name).slice(0, 14);
  const outlineConcepts = (outline.concepts ?? []).filter((concept) => concept.id && concept.name && concept.sectionIds?.length).slice(0, 90);
  const title = clean(outline.title) || "Document";
  const nodes: KnowledgeNode[] = [{
    id: "topic",
    label: title.slice(0, 72),
    kind: "topic",
    x: 0,
    y: 0,
    z: 0,
    note: "Main topic extracted by Gemini using only this document.",
  }];
  const edges: KnowledgeEdge[] = [];
  const sectionNodeIds = new Map<string, string>();
  const sectionPositions = new Map<string, { x: number; y: number; z: number }>();

  sections.forEach((section, index) => {
    const angle = (index / sections.length) * Math.PI * 2 - Math.PI / 2;
    const branchId = `section-${index}`;
    const radius = 270 + (index % 2) * 42;
    sectionNodeIds.set(section.id, branchId);
    sectionPositions.set(section.id, {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius * .72,
      z: (hash(section.name) % 180) - 90,
    });
    nodes.push({
      id: branchId,
      label: clean(section.name).slice(0, 64),
      kind: "branch",
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius * .72,
      z: (hash(section.name) % 180) - 90,
      note: section.evidence ? `Document evidence: “${clean(section.evidence).slice(0, 180)}”` : "Major subtopic extracted from the document.",
    });
    edges.push({ from: "topic", to: branchId, relation: "contains" });
  });

  const conceptNodeIds = new Map<string, string>();
  outlineConcepts.forEach((concept, index) => {
    const validSections = [...new Set(concept.sectionIds)].filter((id) => sectionPositions.has(id));
    if (!validSections.length) return;
    const nodeId = `concept-${key(concept.id || concept.name) || index}`;
    conceptNodeIds.set(concept.id, nodeId);
    const positions = validSections.map((id) => sectionPositions.get(id)!);
    const shared = validSections.length > 1;
    const baseX = positions.reduce((sum, position) => sum + position.x, 0) / positions.length;
    const baseY = positions.reduce((sum, position) => sum + position.y, 0) / positions.length;
    const outward = 105 + (index % 7) * 18;
    const magnitude = Math.max(1, Math.hypot(baseX, baseY));
    const x = shared ? baseX * .68 : baseX + (baseX / magnitude) * outward;
    const y = shared ? baseY * .68 : baseY + (baseY / magnitude) * outward;
    nodes.push({
      id: nodeId,
      label: clean(concept.name).slice(0, 58),
      kind: shared ? "bridge" : "concept",
      x,
      y,
      z: shared ? -45 : (hash(concept.id) % 250) - 125,
      note: `${concept.evidence ? `Document evidence: “${clean(concept.evidence).slice(0, 160)}”` : "Important concept supported by the document."}${concept.aliases?.length ? ` Also named: ${concept.aliases.slice(0, 3).join(", ")}.` : ""}${shared ? ` Shared across ${validSections.length} sections and merged into one node.` : ""}`,
      memoryNote: clean(concept.memoryNote || concept.evidence).slice(0, 320),
      evidence: clean(concept.evidence).slice(0, 320),
    });
    validSections.forEach((sectionId) => {
      const branchId = sectionNodeIds.get(sectionId);
      if (branchId) edges.push({ from: branchId, to: nodeId, relation: shared ? "shared" : "contains" });
    });
  });

  (outline.semanticLinks ?? []).slice(0, 120).forEach((link) => {
    const from = conceptNodeIds.get(link.sourceId) ?? sectionNodeIds.get(link.sourceId);
    const to = conceptNodeIds.get(link.targetId) ?? sectionNodeIds.get(link.targetId);
    if (!from || !to || from === to) return;
    if (edges.some((edge) => edge.from === from && edge.to === to && edge.relation === link.relationship)) return;
    edges.push({ from, to, relation: link.relationship || "related" });
    const source = nodes.find((node) => node.id === from);
    if (source && link.evidence) source.note += ` Connection evidence: “${clean(link.evidence).slice(0, 120)}”`;
  });

  return {
    nodes,
    edges,
    title,
    sectionCount: sections.length,
    sharedCount: outlineConcepts.filter((concept) => new Set(concept.sectionIds).size > 1).length,
    semanticCount: edges.filter((edge) => edge.relation !== "contains" && edge.relation !== "shared").length,
    wordCount,
  };
}

export async function extractDocumentText(file: File): Promise<string> {
  const lower = file.name.toLowerCase();
  const arrayBuffer = await file.arrayBuffer();

  if (lower.endsWith(".docx")) {
    const mammoth = await import("mammoth/mammoth.browser");
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value;
  }

  if (lower.endsWith(".pdf")) {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/legacy/build/pdf.worker.mjs",
      import.meta.url,
    ).toString();
    const document = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
    const pageLines: string[][] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const lines: Array<{ y: number; parts: Array<{ x: number; text: string }> }> = [];
      content.items.forEach((item) => {
        if (!("str" in item) || !item.str.trim() || !("transform" in item)) return;
        const x = item.transform[4];
        const y = item.transform[5];
        let line = lines.find((candidate) => Math.abs(candidate.y - y) < 3);
        if (!line) {
          line = { y, parts: [] };
          lines.push(line);
        }
        line.parts.push({ x, text: item.str.trim() });
      });
      pageLines.push(
        lines
          .sort((a, b) => b.y - a.y)
          .map((line) => line.parts.sort((a, b) => a.x - b.x).map((part) => part.text).join(" ").replace(/\s+/g, " ").trim())
          .filter(Boolean),
      );
    }

    const repeated = new Map<string, number>();
    pageLines.forEach((lines) => {
      new Set(lines.map((line) => line.toLowerCase().replace(/\d+/g, "#").trim()))
        .forEach((line) => repeated.set(line, (repeated.get(line) ?? 0) + 1));
    });
    const repeatThreshold = Math.max(2, Math.ceil(document.numPages * .45));
    const pages = pageLines.map((lines, index) => {
      const useful = lines.filter((line) => {
        const normalizedLine = line.toLowerCase().replace(/\d+/g, "#").trim();
        if (/^(?:page\s*)?\d+(?:\s*of\s*\d+)?$/i.test(line)) return false;
        if (line.length < 100 && (repeated.get(normalizedLine) ?? 0) >= repeatThreshold) return false;
        return true;
      });
      return `[PAGE ${index + 1}]\n${useful.join("\n")}`;
    });
    return pages.join("\n\n").replace(/([A-Za-z])-\n([a-z])/g, "$1$2");
  }

  throw new Error("Choose a PDF or DOCX file.");
}
