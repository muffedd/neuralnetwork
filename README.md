# Knowledge Galaxy

Knowledge Galaxy turns a PDF or DOCX into a source-grounded, gamified concept
network. The learner reads the extracted document beside the graph. Nodes
appear only after reading checkpoints are reached and retrieval questions are
resolved.

## Learning loop

1. Upload a PDF or DOCX.
2. Begin with the central topic node.
3. Read the reconstructed source in the right-hand canvas.
4. Reach a source bookmark and answer a retrieval question.
5. A correct answer unlocks a dark node.
6. A wrong answer triggers a new question, up to three attempts.
7. After three misses, the node unlocks grey and is prioritized for later
   practice.

The local learner model tracks mistake categories, attempts, and response time.
It sends the weakest reasoning category to the question generator while keeping
every question constrained to the uploaded document.

## Local setup

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Create `.env.local`:

```text
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-3.1-flash-lite
```

Never commit API keys.

## Research

See [RESEARCH.md](RESEARCH.md) for the primary studies behind retrieval
checkpoints, knowledge tracing, option tracing, uncertainty, semantic
misconception modeling, and the decision not to infer emotions from mistakes.

## Typography

The interface uses Helvetica and PP Editorial New. PP Editorial New is a
commercial typeface and is intentionally not redistributed in this public
repository. Install a properly licensed local copy or provide licensed webfont
assets for deployment; otherwise the CSS uses its serif fallbacks.

## Build

```bash
npm run build
```
