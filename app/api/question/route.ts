type ErrorType = "definition" | "relationship" | "sequence" | "cause-effect" | "application";
type Question = {
  prompt: string;
  choices: [string, string, string, string];
  correctIndex: number;
  explanation: string;
  errorType: ErrorType;
};

const ERROR_TYPES = new Set<ErrorType>(["definition", "relationship", "sequence", "cause-effect", "application"]);

const clean = (value: unknown, length = 420) =>
  String(value ?? "").replace(/\s+/g, " ").trim().slice(0, length);

const parseJson = (raw: string) => {
  const unfenced = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  return JSON.parse(start >= 0 && end > start ? unfenced.slice(start, end + 1) : unfenced);
};

async function createQuestion(apiKey: string, model: string, prompt: string) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: .18,
          maxOutputTokens: 1_200,
          thinkingConfig: { thinkingLevel: "medium" },
          responseMimeType: "application/json",
        },
      }),
    },
  );
  if (!response.ok) throw new Error(`upstream-${response.status}`);
  const result = await response.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return result.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
}

export async function POST(request: Request) {
  const runtimeEnv = (globalThis as typeof globalThis & {
    __KNOWLEDGE_GALAXY_ENV__?: { GEMINI_API_KEY?: string; GEMINI_MODEL?: string };
  }).__KNOWLEDGE_GALAXY_ENV__;
  const apiKey = runtimeEnv?.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
  const model = runtimeEnv?.GEMINI_MODEL || process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
  if (!apiKey) return Response.json({ error: "Question generation is unavailable." }, { status: 503 });

  let body: {
    node?: { label?: string; evidence?: string; memoryNote?: string };
    distractors?: string[];
    errorType?: ErrorType;
    attempt?: number;
    previousQuestion?: string;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Question request could not be read." }, { status: 400 });
  }

  const label = clean(body.node?.label, 100);
  const evidence = clean(body.node?.evidence);
  const memoryNote = clean(body.node?.memoryNote);
  const errorType = ERROR_TYPES.has(body.errorType as ErrorType) ? body.errorType as ErrorType : "definition";
  if (!label || (!evidence && !memoryNote)) {
    return Response.json({ error: "The source passage is missing." }, { status: 400 });
  }

  const prompt = `Create one multiple-choice retrieval question using ONLY the supplied source-grounded material.

Target concept: ${label}
Source evidence: ${evidence}
Source explanation: ${memoryNote}
Allowed source-grounded distractor material:
${(body.distractors ?? []).slice(0, 5).map((item, index) => `${index + 1}. ${clean(item)}`).join("\n")}

Target the learner's weakest reasoning type: ${errorType}.
This is attempt ${Math.min(3, Math.max(1, Number(body.attempt) || 1))}.
${body.previousQuestion ? `Do not repeat this earlier question: ${clean(body.previousQuestion, 220)}` : ""}

Rules:
- Test understanding, not trivia or wording recall.
- Exactly four concise choices and exactly one supported answer.
- Wrong choices must remain plausible but must not introduce outside facts.
- The explanation must quote or closely paraphrase the supplied material.
- Return only JSON:
{"prompt":"question","choices":["A","B","C","D"],"correctIndex":0,"explanation":"why","errorType":"${errorType}"}`;

  try {
    const value = parseJson(await createQuestion(apiKey, model, prompt)) as Partial<Question>;
    const choices = Array.isArray(value.choices) ? value.choices.map((choice) => clean(choice, 220)).filter(Boolean) : [];
    const correctIndex = Number(value.correctIndex);
    if (!clean(value.prompt) || choices.length !== 4 || !Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) {
      throw new Error("invalid-question");
    }
    const question: Question = {
      prompt: clean(value.prompt),
      choices: choices as Question["choices"],
      correctIndex,
      explanation: clean(value.explanation) || memoryNote || evidence,
      errorType,
    };
    return Response.json({ question, model });
  } catch (reason) {
    console.error("Adaptive question generation failed", reason instanceof Error ? reason.message : String(reason));
    return Response.json({ error: "A source-grounded question could not be created." }, { status: 502 });
  }
}
