import assert from "node:assert/strict";
import test from "node:test";

import {
  fallbackQuestion,
  updateWeaknessProfile,
  weakestErrorTypes,
} from "../app/learning-engine.ts";

test("updates an interpretable weakness profile from learner responses", () => {
  const afterMiss = updateWeaknessProfile({}, "relationship", false, 24_000);
  const afterSuccess = updateWeaknessProfile(afterMiss, "definition", true, 8_000);

  assert.equal(afterSuccess.relationship.attempts, 1);
  assert.equal(afterSuccess.relationship.wrong, 1);
  assert.equal(afterSuccess.definition.correct, 1);
  assert.ok(afterSuccess.relationship.mastery < afterSuccess.definition.mastery);
  assert.equal(weakestErrorTypes(afterSuccess)[0], "relationship");
});

test("creates a source-grounded fallback question without an API", () => {
  const node = {
    id: "concept-atp",
    label: "ATP",
    kind: "concept",
    x: 0,
    y: 0,
    z: 0,
    note: "ATP carries energy.",
    memoryNote: "ATP transfers energy between the two stages.",
  };
  const question = fallbackQuestion(node, [], "relationship");

  assert.equal(question.choices.length, 4);
  assert.equal(question.choices[question.correctIndex], node.memoryNote);
  assert.equal(question.errorType, "relationship");
});
