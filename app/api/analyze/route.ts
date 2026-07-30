type Section = { id: string; name: string; evidence: string };
type Concept = { id: string; name: string; aliases: string[]; evidence: string; memoryNote: string; sectionIds: string[] };
type SemanticLink = {
  sourceId: string;
  targetId: string;
  relationship: "related" | "part-of" | "depends-on" | "produces" | "uses" | "causes" | "contrasts" | "sequence";
  evidence: string;
};
type Outline = { title: string; sections: Section[]; concepts: Concept[]; semanticLinks: SemanticLink[] };

const RELATIONSHIPS = new Set(["related", "part-of", "depends-on", "produces", "uses", "causes", "contrasts", "sequence"]);

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const cleanLabel = (value: unknown) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/^[\s:;,.–—-]+|[\s:;,.–—-]+$/g, "")
    .trim();

const isUsefulLabel = (value: string, maxWords: number) => {
  const words = value.split(/\s+/);
  if (value.length < 2 || value.length > 68 || words.length > maxWords) return false;
  if (/\.{2,}|…|[.!?]$/.test(value)) return false;
  if (/^(?:unit|chapter|page|figure|table|biology|exercise|summary|introduction|references?)\b/i.test(value)) return false;
  if (/^(?:this|that|these|those|it|he|she|they|we)\b/i.test(value)) return false;
  if (/^[A-Z]\s+[A-Z\s]+\d*$/i.test(value) && words.length < 4) return false;
  if (/^\W*\d+(?:\W+\d+)+\W*$/.test(value)) return false;
  return /[A-Za-z]/.test(value);
};

function parseJson(raw: string): unknown {
  const unfenced = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(unfenced);
  } catch {
    const start = unfenced.indexOf("{");
    const end = unfenced.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(unfenced.slice(start, end + 1));
    throw new Error("invalid-json");
  }
}

function sanitizeOutline(value: unknown, documentText: string): { outline: Outline; issues: string[] } {
  const source = (value && typeof value === "object" ? value : {}) as Partial<Outline>;
  const documentNormalized = normalize(documentText);
  const issues: string[] = [];
  const seenSections = new Set<string>();
  const sections = (Array.isArray(source.sections) ? source.sections : [])
    .map((section, index) => ({
      id: cleanLabel(section?.id) || `s${index + 1}`,
      name: cleanLabel(section?.name),
      evidence: cleanLabel(section?.evidence),
    }))
    .filter((section) => {
      if (!isUsefulLabel(section.name, 10) || seenSections.has(section.id)) return false;
      seenSections.add(section.id);
      return true;
    })
    .slice(0, 14);

  const sectionIds = new Set(sections.map((section) => section.id));
  const seenConceptIds = new Set<string>();
  const seenConceptNames = new Set<string>();
  const concepts = (Array.isArray(source.concepts) ? source.concepts : [])
    .map((concept, index) => ({
      id: cleanLabel(concept?.id) || `c${index + 1}`,
      name: cleanLabel(concept?.name),
      aliases: Array.isArray(concept?.aliases) ? concept.aliases.map(cleanLabel).filter(Boolean).slice(0, 8) : [],
      evidence: cleanLabel(concept?.evidence),
      memoryNote: cleanLabel(concept?.memoryNote || concept?.evidence).slice(0, 320),
      sectionIds: Array.isArray(concept?.sectionIds)
        ? [...new Set(concept.sectionIds.map(cleanLabel).filter((id) => sectionIds.has(id)))]
        : [],
    }))
    .filter((concept) => {
      const conceptName = normalize(concept.name);
      if (!isUsefulLabel(concept.name, 7) || !concept.sectionIds.length) return false;
      if (seenConceptIds.has(concept.id) || seenConceptNames.has(conceptName)) return false;
      seenConceptIds.add(concept.id);
      seenConceptNames.add(conceptName);
      return true;
    })
    .slice(0, 90);

  const validConceptIds = new Set(concepts.map((concept) => concept.id));
  const validEndpointIds = new Set([...validConceptIds, ...sectionIds]);
  const seenLinks = new Set<string>();
  const semanticLinks = (Array.isArray(source.semanticLinks) ? source.semanticLinks : [])
    .map((link) => ({
      sourceId: cleanLabel(link?.sourceId),
      targetId: cleanLabel(link?.targetId),
      relationship: cleanLabel(link?.relationship) as SemanticLink["relationship"],
      evidence: cleanLabel(link?.evidence),
    }))
    .filter((link) => {
      const signature = `${link.sourceId}|${link.targetId}|${link.relationship}`;
      if (!validEndpointIds.has(link.sourceId) || !validEndpointIds.has(link.targetId) || link.sourceId === link.targetId) return false;
      if (!RELATIONSHIPS.has(link.relationship) || seenLinks.has(signature)) return false;
      seenLinks.add(signature);
      return true;
    })
    .slice(0, 120);

  let title = cleanLabel(source.title);
  if (!isUsefulLabel(title, 10)) {
    title = sections[0]?.name || "";
    issues.push("The central title was formatting noise instead of a real subject.");
  }
  if (sections.length < 2 && documentText.length > 1500) issues.push("Too few meaningful major topics were identified.");
  if (concepts.length < Math.min(6, Math.max(3, Math.floor(documentText.length / 2500)))) issues.push("Too few useful concepts were extracted.");
  if (concepts.length >= 6 && semanticLinks.length < 2) issues.push("Too few concept-to-concept relationships were created.");
  if (sections.some((section) => concepts.filter((concept) => concept.sectionIds.includes(section.id)).length < 2)) {
    issues.push("At least one major topic has fewer than two useful concepts.");
  }
  const unsupportedEvidence = [...sections, ...concepts]
    .filter((item) => item.evidence.length > 18 && !documentNormalized.includes(normalize(item.evidence)))
    .length;
  if (unsupportedEvidence > Math.max(2, Math.floor((sections.length + concepts.length) * .25))) {
    issues.push("Too many evidence excerpts were not found in the document.");
  }

  return { outline: { title, sections, concepts, semanticLinks }, issues };
}

async function callGemini(apiKey: string, model: string, prompt: string, thinkingLevel: "medium" | "high") {
  const upstream = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: .05,
          maxOutputTokens: 32_000,
          thinkingConfig: { thinkingLevel },
          responseMimeType: "application/json",
        },
      }),
    },
  );
  if (!upstream.ok) {
    const details = await upstream.text();
    console.error("Gemini upstream failure", upstream.status, details.slice(0, 500));
    throw new Error(`upstream-${upstream.status}`);
  }
  const result = await upstream.json() as {
    candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string }> } }>;
  };
  const candidate = result.candidates?.[0];
  const raw = candidate?.content?.parts?.map((part) => part.text || "").join("").trim();
  if (!raw) throw new Error(`empty-${candidate?.finishReason || "response"}`);
  return raw;
}

export async function POST(request: Request) {
  const runtimeEnv = (globalThis as typeof globalThis & {
    __KNOWLEDGE_GALAXY_ENV__?: { GEMINI_API_KEY?: string; GEMINI_MODEL?: string };
  }).__KNOWLEDGE_GALAXY_ENV__;
  const apiKey = runtimeEnv?.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
  const model = runtimeEnv?.GEMINI_MODEL || process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
  if (!apiKey) return Response.json({ error: "The analyzer is temporarily unavailable. Please retry." }, { status: 503 });

  let body: { text?: string; fileName?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "The document request could not be read." }, { status: 400 });
  }
  const text = body.text?.trim();
  if (!text || text.length < 80) {
    return Response.json({ error: "This file contains too little selectable text. Try a text-based PDF or DOCX." }, { status: 400 });
  }

  const clipped = text.slice(0, 650_000);
  const basePrompt = `You are a rigorous closed-document knowledge-graph architect. Build a useful study graph using ONLY <document>.

First clean the source mentally: ignore page markers, running headers, footers, page numbers, unit labels, table-of-contents fragments, biography sidebars, incomplete sentences, equations without a named concept, references, exercises, and OCR noise.

Then:
1. Identify the actual academic subject as the title. Never use "UNIT", "CHAPTER", a sentence fragment, or a truncated line as the title.
2. Identify 2-14 meaningful major topics. Topic names must be concise noun phrases, never raw sentences.
3. Build one GLOBAL inventory of important concepts across the complete document. Extract 4-10 concepts per substantive topic.
4. Reconcile the whole inventory: merge abbreviations, synonyms, paraphrases, singular/plural forms, and repeated mentions into one canonical concept. Preserve document wording in aliases.
5. Assign each canonical concept to EVERY topic where the document discusses it.
6. Add all defensible concept relationships: part-of, depends-on, produces, uses, causes, contrasts, sequence, or related. Prefer precise relations over "related".
7. Every topic, concept, and connection needs a short exact evidence excerpt copied from the document.
8. Use no outside knowledge. Do not infer a connection unless the supplied text supports it.
9. Return only valid JSON. IDs must be unique and links may reference only IDs you created.

Exact JSON shape:
For every concept, memoryNote must be a clear 20-50 word explanation suitable for a flashcard. It must paraphrase only the supplied document and must be understandable without reopening the file.

{"title":"concise subject","sections":[{"id":"s1","name":"concise topic","evidence":"exact excerpt"}],"concepts":[{"id":"c1","name":"canonical concept","aliases":["document alias"],"evidence":"exact excerpt","memoryNote":"short source-grounded explanation for memorization","sectionIds":["s1"]}],"semanticLinks":[{"sourceId":"c1","targetId":"c2","relationship":"related|part-of|depends-on|produces|uses|causes|contrasts|sequence","evidence":"exact excerpt"}]}

Filename: ${body.fileName || "document"}
<document>
${clipped}
</document>`;

  try {
    let raw = await callGemini(apiKey, model, basePrompt, "medium");
    let parsed: unknown;
    try {
      parsed = parseJson(raw);
    } catch {
      parsed = {};
    }
    let checked = sanitizeOutline(parsed, clipped);

    if (checked.issues.length) {
      const correction = `${basePrompt}

QUALITY CHECK FAILED. Start the analysis over; do not patch the prior answer.
Problems to correct:
- ${checked.issues.join("\n- ")}

Your replacement must pass every requirement and contain no raw sentence fragments as node names.`;
      raw = await callGemini(apiKey, model, correction, "high");
      checked = sanitizeOutline(parseJson(raw), clipped);
    }

    if (checked.issues.length || !checked.outline.title || !checked.outline.sections.length || !checked.outline.concepts.length) {
      console.error("Graph quality gate failed", checked.issues.join(" | "));
      return Response.json(
        { error: "The document could not produce a reliable graph yet. Try uploading only the relevant chapter or a cleaner text-based copy." },
        { status: 422 },
      );
    }
    return Response.json({ outline: checked.outline, model });
  } catch (reason) {
    console.error("Analysis pipeline failed", reason instanceof Error ? reason.message : String(reason));
    return Response.json({ error: "The analyzer could not complete this file. Please retry once." }, { status: 502 });
  }
}
