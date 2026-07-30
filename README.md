# Knowledge Galaxy

Knowledge Galaxy turns a PDF or DOCX study document into an interactive
three-dimensional concept network. Gemini extracts the document's major
topics, subtopics, shared concepts, semantic relationships, source-grounded
notes, and study flashcards.

The analysis is closed-document: the generated graph and memory notes are
grounded only in the uploaded source.

## Features

- PDF and DOCX text extraction in the browser
- AI topic and important-subtopic extraction
- Hierarchical and semantic concept connections
- Focused topic views
- Source-grounded memory flashcards
- In-app PDF and DOCX reader
- Light and dark modes

## Local setup

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Create `.env.local` with:

```text
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-3.1-flash-lite
```

Do not commit `.env.local` or API keys.

## Typography

The interface uses Helvetica. Display text is designed for PP Editorial New.
That commercial font is intentionally not redistributed in this public
repository. Install a properly licensed local copy to use it; otherwise the
CSS falls back to Georgia and Times New Roman.

## Production build

```bash
npm run build
```

The application uses vinext and produces a Cloudflare Workers-compatible build.
