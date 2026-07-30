"use client";

import { ChangeEvent, DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildGraphFromOutline,
  extractDocumentText,
  type DocumentOutline,
  type KnowledgeEdge,
  type KnowledgeGraph,
  type KnowledgeNode,
} from "./document-graph";

const DEMO_NODES: KnowledgeNode[] = [
  { id: "topic", label: "Photosynthesis", kind: "topic", x: 0, y: 0, z: 0, note: "Central topic identified from the document." },
  { id: "light", label: "Light-dependent reactions", kind: "branch", x: -260, y: -70, z: 50, note: "Major subtopic detected from the document." },
  { id: "calvin", label: "Calvin cycle", kind: "branch", x: 250, y: 65, z: -35, note: "Major subtopic detected from the document." },
  { id: "chlorophyll", label: "Chlorophyll", kind: "concept", x: -440, y: -210, z: 10, note: "Important concept found in this section." },
  { id: "absorption", label: "Light absorption", kind: "concept", x: -480, y: -35, z: -85, note: "Important concept found in this section." },
  { id: "photolysis", label: "Photolysis", kind: "concept", x: -360, y: 145, z: 85, note: "Important concept found in this section." },
  { id: "electron", label: "Electron transport", kind: "concept", x: -170, y: -245, z: -70, note: "Important concept found in this section." },
  { id: "atp", label: "ATP", kind: "bridge", x: 15, y: -185, z: 120, note: "Shared concept found under two sections and kept as one node." },
  { id: "nadph", label: "NADPH", kind: "bridge", x: 55, y: 195, z: 80, note: "Shared concept found under two sections and kept as one node." },
  { id: "carbon", label: "Carbon fixation", kind: "concept", x: 420, y: -65, z: 95, note: "Important concept found in this section." },
  { id: "glucose", label: "Glucose production", kind: "concept", x: 440, y: 220, z: -65, note: "Important concept found in this section." },
];

const DEMO_EDGES: KnowledgeEdge[] = [
  { from: "topic", to: "light", relation: "contains" },
  { from: "topic", to: "calvin", relation: "contains" },
  { from: "light", to: "chlorophyll", relation: "contains" },
  { from: "light", to: "absorption", relation: "contains" },
  { from: "light", to: "photolysis", relation: "contains" },
  { from: "light", to: "electron", relation: "contains" },
  { from: "light", to: "atp", relation: "shared" },
  { from: "light", to: "nadph", relation: "shared" },
  { from: "calvin", to: "carbon", relation: "contains" },
  { from: "calvin", to: "glucose", relation: "contains" },
  { from: "calvin", to: "atp", relation: "shared" },
  { from: "calvin", to: "nadph", relation: "shared" },
];

const DEMO_GRAPH: KnowledgeGraph = {
  nodes: DEMO_NODES,
  edges: DEMO_EDGES,
  title: "Photosynthesis",
  sectionCount: 2,
  sharedCount: 2,
  wordCount: 0,
};

type FieldPoint = { x: number; y: number; z: number; anchor: string; size: number };
type DocumentPreview =
  | { type: "pdf"; url: string; name: string }
  | { type: "docx"; html: string; name: string };

function makeField(nodes: KnowledgeNode[]): FieldPoint[] {
  let seed = nodes.reduce((sum, node) => sum + node.label.charCodeAt(0), 7419);
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const points: FieldPoint[] = [];
  nodes.forEach((node, nodeIndex) => {
    const count = node.kind === "topic" ? 8 : node.kind === "branch" ? 5 : 2;
    for (let i = 0; i < count; i += 1) {
      const distance = 45 + random() * 105;
      const angle = random() * Math.PI * 2 + nodeIndex * .31;
      points.push({
        x: node.x + Math.cos(angle) * distance,
        y: node.y + Math.sin(angle) * distance,
        z: node.z + (random() - .5) * 190,
        anchor: node.id,
        size: .65 + random() * 1.8,
      });
    }
  });
  return points;
}

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);
  const rotation = useRef({ x: -.12, y: -.08 });
  const zoom = useRef(1);
  const drag = useRef({ active: false, x: 0, y: 0 });
  const dragDistance = useRef(0);
  const projected = useRef(new Map<string, { x: number; y: number; r: number }>());
  const [graph, setGraph] = useState(DEMO_GRAPH);
  const [selected, setSelected] = useState("topic");
  const [mode, setMode] = useState<"all" | "hierarchy" | "bridges">("all");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [fileName, setFileName] = useState("");
  const [processing, setProcessing] = useState("");
  const [error, setError] = useState("");
  const [draggingFile, setDraggingFile] = useState(false);
  const [analysisMode, setAnalysisMode] = useState<"demo" | "gemini">("demo");
  const [lastFile, setLastFile] = useState<File | null>(null);
  const [documentPreview, setDocumentPreview] = useState<DocumentPreview | null>(null);
  const [readerOpen, setReaderOpen] = useState(false);
  const [flashcardId, setFlashcardId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const visibleEdges = useMemo(() => {
    if (!focusId) return graph.edges;
    const direct = graph.edges.filter((edge) => edge.from === focusId || edge.to === focusId);
    const ids = new Set([focusId, ...direct.flatMap((edge) => [edge.from, edge.to])]);
    return graph.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to));
  }, [focusId, graph.edges]);
  const visibleNodes = useMemo(() => {
    if (!focusId) return graph.nodes;
    const ids = new Set([focusId, ...visibleEdges.flatMap((edge) => [edge.from, edge.to])]);
    return graph.nodes.filter((node) => ids.has(node.id));
  }, [focusId, graph.nodes, visibleEdges]);
  const focusNode = useMemo(
    () => graph.nodes.find((node) => node.id === focusId) ?? null,
    [focusId, graph.nodes],
  );
  const fieldPoints = useMemo(() => makeField(visibleNodes), [visibleNodes]);
  const selectedNode = useMemo(
    () => visibleNodes.find((node) => node.id === selected) ?? visibleNodes[0],
    [selected, visibleNodes],
  );
  const canFocusSelected = useMemo(
    () => graph.edges.some((edge) => edge.from === selectedNode.id || edge.to === selectedNode.id),
    [graph.edges, selectedNode.id],
  );
  const studyNodes = useMemo(
    () => graph.nodes.filter((node) => node.kind === "concept" || node.kind === "bridge"),
    [graph.nodes],
  );
  const flashcardNode = useMemo(
    () => studyNodes.find((node) => node.id === flashcardId) ?? null,
    [flashcardId, studyNodes],
  );

  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = wrap.clientWidth;
    const height = wrap.clientHeight;
    const isDark = theme === "dark";
    const nodeInk = isDark ? "#f4f6f5" : "#0a1015";
    const quietInk = isDark ? "#a7afb2" : "#364047";
    const lineInk = isDark ? "232,236,234" : "8,17,23";
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const cosY = Math.cos(rotation.current.y);
    const sinY = Math.sin(rotation.current.y);
    const cosX = Math.cos(rotation.current.x);
    const sinX = Math.sin(rotation.current.x);
    const scaleBase = Math.min(width / 1150, height / 720) * zoom.current;
    const points = new Map<string, { x: number; y: number; z: number; r: number }>();
    const project = (x: number, y: number, z: number, radius = 1) => {
      const x1 = x * cosY - z * sinY;
      const z1 = x * sinY + z * cosY;
      const y1 = y * cosX - z1 * sinX;
      const z2 = y * sinX + z1 * cosX;
      const perspective = 850 / (850 + z2);
      return {
        x: width / 2 + x1 * scaleBase * perspective,
        y: height / 2 + y1 * scaleBase * perspective,
        z: z2,
        r: Math.max(.65, radius * perspective * Math.max(.72, scaleBase)),
      };
    };

    const center = focusNode ?? { x: 0, y: 0, z: 0 };

    visibleNodes.forEach((node) => {
      const baseRadius = node.kind === "topic" ? 12 : node.kind === "branch" ? 8 : node.kind === "bridge" ? 6.5 : 5;
      points.set(node.id, project(node.x - center.x, node.y - center.y, node.z - center.z, baseRadius));
    });

    const fieldProjected = fieldPoints.map((point) => ({
      ...project(point.x - center.x, point.y - center.y, point.z - center.z, point.size),
      anchor: point.anchor,
    }));
    fieldProjected.forEach((point, index) => {
      const anchor = points.get(point.anchor);
      if (!anchor) return;
      ctx.save();
      ctx.strokeStyle = `rgba(${lineInk},${isDark ? ".085" : ".1"})`;
      ctx.lineWidth = .42;
      ctx.beginPath();
      ctx.moveTo(anchor.x, anchor.y);
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
      if (index > 0 && fieldPoints[index - 1].anchor === point.anchor) {
        const previous = fieldProjected[index - 1];
        ctx.beginPath();
        ctx.moveTo(previous.x, previous.y);
        ctx.lineTo(point.x, point.y);
        ctx.stroke();
      }
      ctx.restore();
    });

    visibleEdges.forEach((edge) => {
      const a = points.get(edge.from);
      const b = points.get(edge.to);
      if (!a || !b) return;
      const knowledgeLink = edge.relation !== "contains";
      const shared = edge.relation === "shared";
      const emphasized = mode === "all" || (mode === "hierarchy" && !knowledgeLink) || (mode === "bridges" && knowledgeLink);
      ctx.save();
      ctx.strokeStyle = `rgba(${lineInk},${emphasized ? (knowledgeLink ? ".74" : ".43") : ".1"})`;
      ctx.lineWidth = emphasized ? (knowledgeLink ? 1.25 : .8) : .42;
      ctx.setLineDash(knowledgeLink ? (shared ? [4, 4] : [1.5, 3]) : []);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.restore();
    });

    fieldProjected.sort((a, b) => b.z - a.z).forEach((point) => {
      const depthAlpha = Math.max(.1, Math.min(.55, .3 - point.z / 1500));
      ctx.save();
      ctx.fillStyle = `rgba(${lineInk},${depthAlpha})`;
      ctx.shadowColor = nodeInk;
      ctx.shadowBlur = point.z < -70 ? 4 : point.z > 90 ? 1.5 : 0;
      ctx.beginPath();
      ctx.arc(point.x, point.y, point.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    [...visibleNodes]
      .sort((a, b) => (points.get(b.id)?.z ?? 0) - (points.get(a.id)?.z ?? 0))
      .forEach((node) => {
        const point = points.get(node.id);
        if (!point) return;
        const active = selected === node.id;
        ctx.save();
        ctx.shadowColor = nodeInk;
        ctx.shadowBlur = active ? 9 : Math.max(0, 3 - point.z / 90);
        ctx.fillStyle = nodeInk;
        ctx.beginPath();
        ctx.arc(point.x, point.y, active ? point.r * 1.18 : point.r, 0, Math.PI * 2);
        ctx.fill();
        if (node.kind === "bridge") {
          ctx.strokeStyle = nodeInk;
          ctx.lineWidth = .7;
          ctx.setLineDash([2, 3]);
          ctx.beginPath();
          ctx.arc(point.x, point.y, point.r * 1.75, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
        ctx.fillStyle = active ? nodeInk : quietInk;
        ctx.font = `${active ? 650 : 500} ${node.kind === "topic" ? 12 : 9}px Helvetica, "Helvetica Neue", Arial, sans-serif`;
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        const maxLabel = node.label.length > 34 ? `${node.label.slice(0, 32)}…` : node.label;
        ctx.fillText(maxLabel, point.x + point.r + 7, point.y - 5);
      });

    projected.current = new Map([...points].map(([id, point]) => [id, { x: point.x, y: point.y, r: Math.max(15, point.r + 8) }]));
  }, [fieldPoints, focusNode, mode, selected, theme, visibleEdges, visibleNodes]);

  useEffect(() => {
    draw();
    const resize = new ResizeObserver(draw);
    if (wrapRef.current) resize.observe(wrapRef.current);
    return () => resize.disconnect();
  }, [draw]);

  const analyzeFile = async (file?: File) => {
    if (!file) return;
    if (!/\.(pdf|docx)$/i.test(file.name)) {
      setError("Choose a PDF or DOCX file.");
      return;
    }
    setError("");
    setLastFile(file);
    setProcessing("Reading document…");
    try {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
      if (file.name.toLowerCase().endsWith(".pdf")) {
        const url = URL.createObjectURL(file);
        previewUrlRef.current = url;
        setDocumentPreview({ type: "pdf", url, name: file.name });
      } else {
        const [mammoth, purifierModule] = await Promise.all([
          import("mammoth/mammoth.browser"),
          import("dompurify"),
        ]);
        const converted = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
        setDocumentPreview({
          type: "docx",
          html: purifierModule.default.sanitize(converted.value, {
            USE_PROFILES: { html: true },
            FORBID_TAGS: ["script", "style", "iframe", "object", "embed"],
          }),
          name: file.name,
        });
      }
      const text = await extractDocumentText(file);
      if (text.trim().length < 80) throw new Error("This document contains too little selectable text. Scanned PDFs need OCR first.");
      setProcessing("Gemini is mapping topics…");
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, fileName: file.name }),
      });
      const result = await response.json() as { outline?: DocumentOutline; error?: string };
      if (!response.ok || !result.outline) throw new Error(result.error || "Gemini analysis failed.");
      const nextGraph: KnowledgeGraph = buildGraphFromOutline(result.outline, text.trim().split(/\s+/).length);
      if (nextGraph.nodes.length < 5 || nextGraph.sectionCount < 1) {
        throw new Error("The extracted graph did not pass the quality check. Try a cleaner copy of the chapter.");
      }
      setGraph(nextGraph);
      setAnalysisMode("gemini");
      setSelected("topic");
      setFocusId(null);
      setFlashcardId(null);
      setFileName(file.name);
      rotation.current = { x: -.12, y: -.08 };
      zoom.current = nextGraph.nodes.length > 35 ? .8 : 1;
      setProcessing("");
    } catch (reason) {
      setProcessing("");
      setError(reason instanceof Error ? reason.message : "The document could not be read.");
    }
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    void analyzeFile(event.target.files?.[0]);
    event.target.value = "";
  };

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDraggingFile(false);
    void analyzeFile(event.dataTransfer.files?.[0]);
  };

  const reset = () => {
    rotation.current = { x: -.12, y: -.08 };
    zoom.current = focusId ? 1.25 : graph.nodes.length > 35 ? .8 : 1;
    setSelected(focusId || "topic");
    draw();
  };

  const focusSelected = () => {
    if (!canFocusSelected) return;
    setFocusId(selectedNode.id);
    setSelected(selectedNode.id);
    rotation.current = { x: -.08, y: -.05 };
    const children = graph.edges.filter((edge) => edge.from === selectedNode.id).length;
    zoom.current = children > 7 ? 1.02 : 1.28;
  };

  const exitFocus = () => {
    setFocusId(null);
    rotation.current = { x: -.12, y: -.08 };
    zoom.current = graph.nodes.length > 35 ? .8 : 1;
  };

  const openFlashcard = (node: KnowledgeNode) => {
    setSelected(node.id);
    if (node.kind === "concept" || node.kind === "bridge") setFlashcardId(node.id);
  };

  const moveFlashcard = (direction: -1 | 1) => {
    if (!flashcardNode || !studyNodes.length) return;
    const index = studyNodes.findIndex((node) => node.id === flashcardNode.id);
    const next = studyNodes[(index + direction + studyNodes.length) % studyNodes.length];
    setFlashcardId(next.id);
    setSelected(next.id);
  };

  return (
    <main
      className={`shell ${theme} ${draggingFile ? "file-dragging" : ""}`}
      onDragEnter={(event) => { event.preventDefault(); setDraggingFile(true); }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => { if (event.currentTarget === event.target) setDraggingFile(false); }}
      onDrop={onDrop}
    >
      <input ref={inputRef} className="file-input" type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={onFileChange} />
      <div className="star-field" aria-hidden="true" />
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" />
          <div><strong>Knowledge Galaxy</strong><span>closed-document concept map</span></div>
        </div>
        <div className="top-actions">
          {studyNodes.length > 0 && analysisMode === "gemini" && (
            <button className="study-small" onClick={() => openFlashcard(studyNodes[0])}>Study cards</button>
          )}
          {documentPreview && (
            <button className="reader-small" onClick={() => setReaderOpen(true)}>Read document</button>
          )}
          <button className="upload-small" onClick={() => inputRef.current?.click()}>{fileName ? "Replace file" : "Upload document"}</button>
          <div className="theme-switch" aria-label="Colour mode">
            <button className={theme === "light" ? "active" : ""} onClick={() => setTheme("light")}>Light</button>
            <button className={theme === "dark" ? "active" : ""} onClick={() => setTheme("dark")}>Dark</button>
          </div>
          <div className="source-pill"><span /> {analysisMode === "gemini" ? "GEMINI 3.1 · VERIFIED" : "DEMO GRAPH"}</div>
        </div>
      </header>

      <section className="intro">
        <div>
          <p className="eyebrow">{fileName ? "Document network generated" : "Your document becomes a memory map"}</p>
          <h1>{fileName ? graph.title : <>See how ideas <em>connect.</em></>}</h1>
          <p>{fileName ? `${graph.wordCount.toLocaleString()} words · ${graph.sectionCount} sections · ${graph.sharedCount} shared concepts · ${graph.semanticCount ?? 0} semantic links` : "Upload a PDF or DOCX. Gemini maps only the document text—no outside knowledge."}</p>
        </div>
        <button className="upload-primary" onClick={() => inputRef.current?.click()}>
          <span>+</span>{fileName ? "Analyze another document" : "Choose PDF or DOCX"}<small>Closed-document analysis</small>
        </button>
      </section>

      {error && (
        <div className="error-message" role="alert">
          <span>{error}</span>
          {lastFile && <button onClick={() => void analyzeFile(lastFile)}>Retry analysis</button>}
        </div>
      )}

      <section className="workspace">
        <div className="graph-wrap" ref={wrapRef}>
          <canvas
            ref={canvasRef}
            aria-label={`Interactive concept map of ${graph.title}`}
            tabIndex={0}
            onPointerDown={(event) => {
              drag.current = { active: true, x: event.clientX, y: event.clientY };
              dragDistance.current = 0;
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (!drag.current.active) return;
              rotation.current.y += (event.clientX - drag.current.x) * .006;
              rotation.current.x += (event.clientY - drag.current.y) * .006;
              dragDistance.current += Math.abs(event.clientX - drag.current.x) + Math.abs(event.clientY - drag.current.y);
              drag.current.x = event.clientX;
              drag.current.y = event.clientY;
              draw();
            }}
            onPointerUp={(event) => {
              drag.current.active = false;
              if (dragDistance.current < 8) {
                let closest: { id: string; distance: number } | null = null;
                projected.current.forEach((point, id) => {
                  const distance = Math.hypot(event.nativeEvent.offsetX - point.x, event.nativeEvent.offsetY - point.y);
                  if (distance < point.r && (!closest || distance < closest.distance)) closest = { id, distance };
                });
                if (closest) {
                  const node = visibleNodes.find((candidate) => candidate.id === closest.id);
                  if (node) openFlashcard(node);
                }
              }
            }}
            onWheel={(event) => {
              event.preventDefault();
              zoom.current = Math.min(1.6, Math.max(.52, zoom.current - event.deltaY * .0008));
              draw();
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") rotation.current.y -= .1;
              else if (event.key === "ArrowRight") rotation.current.y += .1;
              else if (event.key === "ArrowUp") rotation.current.x -= .1;
              else if (event.key === "ArrowDown") rotation.current.x += .1;
              else if (event.key === "+" || event.key === "=") zoom.current = Math.min(1.6, zoom.current + .1);
              else if (event.key === "-") zoom.current = Math.max(.52, zoom.current - .1);
              else return;
              event.preventDefault();
              draw();
            }}
          />
          <div className="orbit-hint">DRAG TO ORBIT <span>·</span> SCROLL TO ZOOM <span>·</span> CLICK A NODE</div>
          <div className="mode-switch" aria-label="Graph view">
            {focusId && <button className="back-map" onClick={exitFocus}>← Full map</button>}
            {(["all", "hierarchy", "bridges"] as const).map((item) => (
              <button className={mode === item ? "active" : ""} key={item} onClick={() => setMode(item)}>
                {item === "all" ? "Network" : item === "hierarchy" ? "Structure" : "Connections"}
              </button>
            ))}
            <button className="reset" onClick={reset} aria-label="Reset graph view">↺</button>
          </div>
          {processing && <div className="processing"><i /><strong>{processing}</strong><span>The file stays local; extracted text is sent securely for analysis.</span></div>}
          {flashcardNode && (
            <div className="flashcard-layer" role="dialog" aria-label={`Memory card for ${flashcardNode.label}`}>
              <article className="flashcard">
                <header>
                  <span>Source memory card</span>
                  <button onClick={() => setFlashcardId(null)} aria-label="Close memory card">×</button>
                </header>
                <div className="flashcard-number">
                  {studyNodes.findIndex((node) => node.id === flashcardNode.id) + 1} / {studyNodes.length}
                </div>
                <h3>{flashcardNode.label}</h3>
                <p>{flashcardNode.memoryNote || flashcardNode.note}</p>
                {flashcardNode.evidence && (
                  <blockquote><span>From your document</span>“{flashcardNode.evidence}”</blockquote>
                )}
                <footer>
                  <button onClick={() => moveFlashcard(-1)}>← Previous</button>
                  {documentPreview && <button onClick={() => setReaderOpen(true)}>Read source</button>}
                  <button onClick={() => moveFlashcard(1)}>Next →</button>
                </footer>
              </article>
            </div>
          )}
        </div>

        <aside className="inspector">
          {focusNode && (
            <div className="focus-banner">
              <span>Focused view</span>
              <b>{focusNode.label}</b>
              <button onClick={exitFocus}>Show full network</button>
            </div>
          )}
          <div className="inspector-head">
            <span className={`node-icon ${selectedNode.kind}`} />
            <span>{selectedNode.kind === "topic" ? "Main topic" : selectedNode.kind === "branch" ? "Subtopic" : selectedNode.kind === "bridge" ? "Shared concept" : "Supporting concept"}</span>
          </div>
          <h2>{selectedNode.label}</h2>
          <p>{selectedNode.note}</p>
          {canFocusSelected && focusId !== selectedNode.id && (
            <button className="focus-action" onClick={focusSelected}>
              <span>◎</span>
              <b>Focus this topic</b>
              <small>Show only this node and its closest connected concepts</small>
            </button>
          )}
          {selectedNode.kind === "bridge" && (
            <div className="bridge-callout"><span className="spark">✦</span><div><strong>Memory bridge</strong><small>One node shared across document sections</small></div></div>
          )}
          <div className="relations">
            <span>Connected relationships</span>
            {visibleEdges.filter((edge) => edge.from === selectedNode.id || edge.to === selectedNode.id).map((edge, index) => {
              const other = visibleNodes.find((node) => node.id === (edge.from === selectedNode.id ? edge.to : edge.from));
              return (
                <button key={`${edge.from}-${edge.to}-${index}`} onClick={() => other && openFlashcard(other)}>
                  <i /><b>{other?.label}</b><em>{edge.relation}</em>
                </button>
              );
            })}
          </div>
          <div className="legend"><span><i /> hierarchy</span><span><i className="dashed" /> knowledge connection</span></div>
        </aside>
      </section>

      {draggingFile && <div className="drop-overlay"><strong>Drop the document</strong><span>PDF or DOCX · closed-document analysis</span></div>}
      {readerOpen && documentPreview && (
        <div className="reader-overlay" role="dialog" aria-label={`Reading ${documentPreview.name}`} onClick={() => setReaderOpen(false)}>
          <aside className="document-reader" onClick={(event) => event.stopPropagation()}>
            <header>
              <div><span>Your source document</span><strong>{documentPreview.name}</strong></div>
              <button onClick={() => setReaderOpen(false)} aria-label="Close document reader">×</button>
            </header>
            {documentPreview.type === "pdf" ? (
              <iframe src={documentPreview.url} title={documentPreview.name} />
            ) : (
              <article className="docx-reader" dangerouslySetInnerHTML={{ __html: documentPreview.html }} />
            )}
          </aside>
        </div>
      )}
    </main>
  );
}
