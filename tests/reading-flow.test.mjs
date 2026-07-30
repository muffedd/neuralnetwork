import assert from "node:assert/strict";
import test from "node:test";

import { findEvidenceParagraph, splitDocumentText } from "../app/reading-flow.ts";

test("splits source text into readable line-sized units while preserving page markers", () => {
  const units = splitDocumentText(
    "[PAGE 1]\n\nPhotosynthesis converts light energy into chemical energy. " +
      "This deliberately long sentence contains enough additional words to require another readable unit without losing any of its source meaning or silently removing the final words from the document.",
  );

  assert.equal(units[0], "[PAGE 1]");
  assert.ok(units.slice(1).every((unit) => unit.length <= 180));
  assert.match(units.join(" "), /final words from the document/);
});

test("grounds a checkpoint near the strongest source evidence", () => {
  const paragraphs = [
    "Plants contain many specialised structures.",
    "Chlorophyll absorbs light energy for photosynthesis.",
    "Glucose stores some of the captured chemical energy.",
  ];
  const position = findEvidenceParagraph(
    {
      id: "chlorophyll",
      label: "Chlorophyll",
      kind: "concept",
      x: 0,
      y: 0,
      z: 0,
      note: "Chlorophyll absorbs light energy.",
    },
    paragraphs,
    0,
  );

  assert.equal(position, 1);
});
