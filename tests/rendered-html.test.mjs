import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the graph and reading workspace", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /class="graph-wrap"/);
  assert.match(html, /<canvas[^>]+Interactive concept map/i);
  assert.match(html, /class="reading-pane"/);
  assert.match(html, /class="reading-scroll"/);
  assert.match(html, /Start with one node/);
});

test("keeps the canvas visible and the reading canvas non-interruptive", async () => {
  const [css, page] = await Promise.all([
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(css, /\.graph-wrap\s*\{[^}]*height:\s*100%/s);
  assert.match(css, /\.graph-wrap\s*>\s*canvas\s*\{[^}]*position:\s*absolute/s);
  assert.match(css, /\.reading-pane\s*\{[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.reading-scroll\s*\{[^}]*overflow-y:\s*scroll/s);
  assert.match(css, /\.inspector\s*\{[^}]*display:\s*none/s);
  assert.match(css, /\.reading-paragraph\.active\s*>\s*p\s*\{[^}]*color:\s*var\(--ink\)/s);
  assert.match(css, /\.reading-paragraph\.read\s*>\s*p\s*\{[^}]*color:\s*color-mix/s);
  assert.match(css, /\.checkpoint-notice\s*\{[^}]*position:\s*absolute/s);
  assert.match(page, /node\.kind === "topic" \? 18/);
  assert.match(page, /\[1\.7,\s*2\.4\]/);
  assert.match(page, /setCheckpointNoticeId\(nextLocked\.id\)/);
  assert.match(page, /aria-label="Close checkpoint"/);
  assert.doesNotMatch(page, /markerTop[^;]+beginCheckpoint\(nextLocked\)/s);
});
