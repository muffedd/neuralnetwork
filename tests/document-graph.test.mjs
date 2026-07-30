import assert from "node:assert/strict";
import test from "node:test";

import { buildGraphFromOutline } from "../app/document-graph.ts";

test("builds positioned section and shared-concept nodes from an AI outline", () => {
  const graph = buildGraphFromOutline(
    {
      title: "Photosynthesis",
      sections: [
        { id: "light", name: "Light reactions", evidence: "Light reactions make ATP." },
        { id: "calvin", name: "Calvin cycle", evidence: "The Calvin cycle uses ATP." },
      ],
      concepts: [
        {
          id: "atp",
          name: "ATP",
          aliases: [],
          evidence: "ATP connects both stages.",
          memoryNote: "ATP transfers energy between the stages.",
          sectionIds: ["light", "calvin"],
        },
      ],
      semanticLinks: [],
    },
    100,
  );

  assert.equal(graph.nodes.length, 4);
  assert.equal(graph.sharedCount, 1);
  assert.ok(
    graph.nodes.every(
      (node) =>
        Number.isFinite(node.x) &&
        Number.isFinite(node.y) &&
        Number.isFinite(node.z),
    ),
  );
});
