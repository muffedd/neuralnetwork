import type { KnowledgeNode } from "./document-graph";

export type NodeProgress = "mastered" | "fragile";
export type ErrorType = "definition" | "relationship" | "sequence" | "cause-effect" | "application";

export type SkillSignal = {
  attempts: number;
  correct: number;
  wrong: number;
  mastery: number;
  uncertainty: number;
  meanLatencyMs: number;
};

export type WeaknessProfile = Partial<Record<ErrorType, SkillSignal>>;

export type AdaptiveQuestion = {
  prompt: string;
  choices: [string, string, string, string];
  correctIndex: number;
  explanation: string;
  errorType: ErrorType;
};

export const ERROR_TYPES: ErrorType[] = [
  "definition",
  "relationship",
  "sequence",
  "cause-effect",
  "application",
];

const sigmoid = (value: number) => 1 / (1 + Math.exp(-value));

export function updateWeaknessProfile(
  profile: WeaknessProfile,
  errorType: ErrorType,
  correct: boolean,
  latencyMs: number,
): WeaknessProfile {
  const prior = profile[errorType] ?? {
    attempts: 0,
    correct: 0,
    wrong: 0,
    mastery: .4,
    uncertainty: 1,
    meanLatencyMs: 0,
  };
  const attempts = prior.attempts + 1;
  const successes = prior.correct + (correct ? 1 : 0);
  const failures = prior.wrong + (correct ? 0 : 1);
  const meanLatencyMs = prior.attempts
    ? ((prior.meanLatencyMs * prior.attempts) + latencyMs) / attempts
    : latencyMs;
  const hesitationPenalty = meanLatencyMs > 35_000 ? .18 : meanLatencyMs > 20_000 ? .08 : 0;

  // A compact Performance-Factors-style online learner model. It stays
  // interpretable and works before there is enough population data for a DKT.
  const mastery = sigmoid(-.35 + successes * .9 - failures * .62 - hesitationPenalty);

  return {
    ...profile,
    [errorType]: {
      attempts,
      correct: successes,
      wrong: failures,
      mastery,
      uncertainty: 1 / Math.sqrt(attempts + 1),
      meanLatencyMs,
    },
  };
}

export function weakestErrorTypes(profile: WeaknessProfile): ErrorType[] {
  return [...ERROR_TYPES].sort((a, b) => {
    const aSignal = profile[a];
    const bSignal = profile[b];
    const aPriority = (aSignal?.mastery ?? .42) - (aSignal?.uncertainty ?? 1) * .08;
    const bPriority = (bSignal?.mastery ?? .42) - (bSignal?.uncertainty ?? 1) * .08;
    return aPriority - bPriority;
  });
}

export function nextCheckpointAttempt(failedAttempts = 0) {
  return Math.min(3, Math.max(0, Math.floor(failedAttempts)) + 1);
}

export function fallbackQuestion(
  node: KnowledgeNode,
  distractorNodes: KnowledgeNode[],
  errorType: ErrorType,
): AdaptiveQuestion {
  const correct = node.memoryNote || node.evidence || node.note;
  const distractors = distractorNodes
    .map((item) => item.memoryNote || item.evidence || item.note)
    .filter((item) => item && item !== correct)
    .slice(0, 3);
  while (distractors.length < 3) {
    distractors.push(`This statement is not supported for ${node.label} by the selected source passage.`);
  }
  const offset = node.label.length % 4;
  const choices = [...distractors];
  choices.splice(offset, 0, correct);

  return {
    prompt: `Which statement best matches “${node.label}” in your document?`,
    choices: choices.slice(0, 4) as AdaptiveQuestion["choices"],
    correctIndex: offset,
    explanation: correct,
    errorType,
  };
}
