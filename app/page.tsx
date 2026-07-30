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
import {
  fallbackQuestion,
  updateWeaknessProfile,
  weakestErrorTypes,
  type AdaptiveQuestion,
  type NodeProgress,
  type WeaknessProfile,
} from "./learning-engine";

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
type QuizSession = {
  nodeId: string;
  attempt: number;
  question: AdaptiveQuestion;
};
type QuizOutcome = "retry" | "mastered" | "fragile" | null;

function splitDocumentText(text: string): string[] {
  const normalized = text.replace(/\r/g, "").replace(/\u0000/g, " ").trim();
  if (!normalized) return [];
  const blocks = normalized
    .replace(/(\[PAGE \d+\])/g, "\n\n$1\n\n")
    .split(/\n{2,}/)
    .map((block) => block.replace(/\n+/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const paragraphs: string[] = [];
  blocks.forEach((block) => {
    if (block.length <= 680 || /^\[PAGE \d+\]$/.test(block)) {
      paragraphs.push(block);
      return;
    }
    const sentences = block.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [block];
    let paragraph = "";
    sentences.forEach((sentence) => {
      if (paragraph && paragraph.length + sentence.length > 540) {
        paragraphs.push(paragraph.trim());
        paragraph = "";
      }
      paragraph += `${sentence.trim()} `;
    });
    if (paragraph.trim()) paragraphs.push(paragraph.trim());
  });
  return paragraphs;
}

const READER_STOP_WORDS = new Set(
  "about after also and are because been before being between both but can could does for from has have into its more most not only other over same should such than that the their them then there these they this those through under very was were what when where which while will with would".split(" "),
);

function findEvidenceParagraph(node: KnowledgeNode, paragraphs: string[], fallback: number) {
  const source = `${node.label} ${node.evidence || ""} ${node.memoryNote || ""} ${node.note || ""}`
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ");
  const tokens = [...new Set(source.split(/\s+/).filter((token) => token.length > 3 && !READER_STOP_WORDS.has(token)))];
  if (!tokens.length) return fallback;
  let bestIndex = fallback;
  let bestScore = 0;
  paragraphs.forEach((paragraph, index) => {
    if (/^\[PAGE \d+\]$/.test(paragraph)) return;
    const candidate = paragraph.toLowerCase();
    const matches = tokens.filter((token) => candidate.includes(token)).length;
    const score = matches / tokens.length;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  return bestScore >= .12 ? bestIndex : fallback;
}

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
  const readerScrollRef = useRef<HTMLDivElement>(null);
  const questionStartedAt = useRef(0);
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
  const [documentText, setDocumentText] = useState("");
  const [readerOpen, setReaderOpen] = useState(false);
  const [flashcardId, setFlashcardId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [nodeProgress, setNodeProgress] = useState<Record<string, NodeProgress>>({});
  const [weaknessProfile, setWeaknessProfile] = useState<WeaknessProfile>({});
  const [quiz, setQuiz] = useState<QuizSession | null>(null);
  const [quizLoading, setQuizLoading] = useState("");
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [quizOutcome, setQuizOutcome] = useState<QuizOutcome>(null);
  const learningNodes = useMemo(() => {
    const ordered: KnowledgeNode[] = [];
    const seen = new Set<string>();
    graph.nodes.filter((node) => node.kind === "branch").forEach((branch) => {
      ordered.push(branch);
      seen.add(branch.id);
      graph.edges
        .filter((edge) => edge.from === branch.id)
        .forEach((edge) => {
          const node = graph.nodes.find((candidate) => candidate.id === edge.to);
          if (node && node.kind !== "topic" && !seen.has(node.id)) {
            ordered.push(node);
            seen.add(node.id);
          }
        });
    });
    graph.nodes.forEach((node) => {
      if (node.kind !== "topic" && !seen.has(node.id)) ordered.push(node);
    });
    return ordered;
  }, [graph]);
  const progressionEnabled = analysisMode === "gemini" && Boolean(documentText);
  const availableNodes = useMemo(
    () => progressionEnabled
      ? graph.nodes.filter((node) => node.id === "topic" || Boolean(nodeProgress[node.id]))
      : graph.nodes,
    [graph.nodes, nodeProgress, progressionEnabled],
  );
  const availableNodeIds = useMemo(() => new Set(availableNodes.map((node) => node.id)), [availableNodes]);
  const visibleEdges = useMemo(() => {
    const availableEdges = graph.edges.filter((edge) => availableNodeIds.has(edge.from) && availableNodeIds.has(edge.to));
    if (!focusId) return availableEdges;
    const direct = availableEdges.filter((edge) => edge.from === focusId || edge.to === focusId);
    const ids = new Set([focusId, ...direct.flatMap((edge) => [edge.from, edge.to])]);
    return availableEdges.filter((edge) => ids.has(edge.from) && ids.has(edge.to));
  }, [availableNodeIds, focusId, graph.edges]);
  const visibleNodes = useMemo(() => {
    if (!focusId) return availableNodes;
    const ids = new Set([focusId, ...visibleEdges.flatMap((edge) => [edge.from, edge.to])]);
    return availableNodes.filter((node) => ids.has(node.id));
  }, [availableNodes, focusId, visibleEdges]);
  const focusNode = useMemo(
    () => graph.nodes.find((node) => node.id === focusId) ?? null,
    [focusId, graph.nodes],
  );
  const fieldPoints = useMemo(() => makeField(visibleNodes), [visibleNodes]);
  const selectedNode = useMemo(
    () => visibleNodes.find((node) => node.id === selected) ?? visibleNodes[0] ?? graph.nodes[0],
    [selected, visibleNodes],
  );
  const canFocusSelected = useMemo(
    () => Boolean(selectedNode) && visibleEdges.some((edge) => edge.from === selectedNode.id || edge.to === selectedNode.id),
    [selectedNode, visibleEdges],
  );
  const studyNodes = useMemo(
    () => availableNodes.filter((node) => node.kind === "concept" || node.kind === "bridge"),
    [availableNodes],
  );
  const flashcardNode = useMemo(
    () => studyNodes.find((node) => node.id === flashcardId) ?? null,
    [flashcardId, studyNodes],
  );
  const readerParagraphs = useMemo(() => splitDocumentText(documentText), [documentText]);
  const checkpointsByParagraph = useMemo(() => {
    const checkpoints = new Map<number, KnowledgeNode[]>();
    if (!readerParagraphs.length || !learningNodes.length) return checkpoints;
    let lastPosition = 0;
    learningNodes.forEach((node, index) => {
      const fallback = Math.min(
        readerParagraphs.length - 1,
        Math.max(0, Math.floor(((index + 1) / (learningNodes.length + 1)) * readerParagraphs.length)),
      );
      const position = Math.max(lastPosition, findEvidenceParagraph(node, readerParagraphs, fallback));
      lastPosition = position;
      checkpoints.set(position, [...(checkpoints.get(position) ?? []), node]);
    });
    return checkpoints;
  }, [learningNodes, readerParagraphs.length]);
  const completedCount = useMemo(
    () => learningNodes.filter((node) => Boolean(nodeProgress[node.id])).length,
    [learningNodes, nodeProgress],
  );

  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("knowledge-galaxy-weakness-v1");
      if (saved) setWeaknessProfile(JSON.parse(saved) as WeaknessProfile);
    } catch {
      // A private learner profile is optional; the study flow works without storage.
    }
  }, []);

  useEffect(() => {
    if (!Object.keys(weaknessProfile).length) return;
    try {
      window.localStorage.setItem("knowledge-galaxy-weakness-v1", JSON.stringify(weaknessProfile));
    } catch {
      // Storage can be disabled; keep the in-memory learner model active.
    }
  }, [weaknessProfile]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, wrap.clientWidth);
    const height = Math.max(1, wrap.clientHeight);
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
      const baseRadius = node.kind === "topic" ? 18 : node.kind === "branch" ? 8 : node.kind === "bridge" ? 6.5 : 5;
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
      const sparseGraph = visibleNodes.length < 4;
      ctx.strokeStyle = `rgba(${lineInk},${emphasized ? (knowledgeLink ? ".74" : ".43") : sparseGraph ? ".28" : ".1"})`;
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
        const fragile = nodeProgress[node.id] === "fragile";
        const nodeColor = fragile ? quietInk : nodeInk;
        ctx.save();
        if (node.kind === "topic") {
          ctx.strokeStyle = nodeColor;
          ctx.lineWidth = .75;
          ctx.globalAlpha = .18;
          [1.7, 2.4].forEach((ring) => {
            ctx.beginPath();
            ctx.arc(point.x, point.y, point.r * ring, 0, Math.PI * 2);
            ctx.stroke();
          });
          ctx.globalAlpha = 1;
        }
        ctx.shadowColor = nodeColor;
        ctx.shadowBlur = fragile ? 1 : active ? 9 : Math.max(0, 3 - point.z / 90);
        ctx.fillStyle = nodeColor;
        ctx.beginPath();
        ctx.arc(point.x, point.y, active ? point.r * 1.18 : point.r, 0, Math.PI * 2);
        ctx.fill();
        if (node.kind === "bridge") {
          ctx.strokeStyle = nodeColor;
          ctx.lineWidth = .7;
          ctx.setLineDash([2, 3]);
          ctx.beginPath();
          ctx.arc(point.x, point.y, point.r * 1.75, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
        ctx.fillStyle = fragile ? quietInk : active ? nodeInk : quietInk;
        ctx.font = `${active ? 650 : 500} ${node.kind === "topic" ? 12 : 9}px Helvetica, "Helvetica Neue", Arial, sans-serif`;
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        const maxLabel = node.label.length > 34 ? `${node.label.slice(0, 32)}…` : node.label;
        ctx.fillText(maxLabel, point.x + point.r + 7, point.y - 5);
      });

    projected.current = new Map([...points].map(([id, point]) => [id, { x: point.x, y: point.y, r: Math.max(15, point.r + 8) }]));
  }, [fieldPoints, focusNode, mode, nodeProgress, selected, theme, visibleEdges, visibleNodes]);

  useEffect(() => {
    let resizeFrame = window.requestAnimationFrame(draw);
    const resize = new ResizeObserver(() => {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(draw);
    });
    if (wrapRef.current) resize.observe(wrapRef.current);
    return () => {
      window.cancelAnimationFrame(resizeFrame);
      resize.disconnect();
    };
  }, [draw]);

  const analyzeFile = async (file?: File) => {
    if (!file) return;
    if (!/\.(pdf|docx)$/i.test(file.name)) {
      setError("Choose a PDF or DOCX file.");
      return;
    }
    setError("");
    setLastFile(file);
    setDocumentText("");
    setNodeProgress({});
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
      setDocumentText(text);
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
      setMode("all");
      setSelected("topic");
      setFocusId(null);
      setFlashcardId(null);
      setNodeProgress({ topic: "mastered" });
      setQuiz(null);
      setSelectedAnswer(null);
      setQuizOutcome(null);
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

  const jumpToNode = (nodeId: string) => {
    setSelected(nodeId);
    if (nodeId === "topic") {
      readerScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    const marker = readerScrollRef.current?.querySelector<HTMLElement>(
      `[data-checkpoint-id="${CSS.escape(nodeId)}"]`,
    );
    marker?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const requestAdaptiveQuestion = async (
    node: KnowledgeNode,
    attempt: number,
    previousQuestion = "",
    profile = weaknessProfile,
  ) => {
    const errorType = weakestErrorTypes(profile)[0];
    const distractorNodes = learningNodes.filter((candidate) => candidate.id !== node.id);
    setQuizLoading(node.label);
    try {
      const response = await fetch("/api/question", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          node: {
            label: node.label,
            evidence: node.evidence || node.note,
            memoryNote: node.memoryNote || node.note,
          },
          distractors: distractorNodes
            .map((candidate) => candidate.memoryNote || candidate.evidence || candidate.note)
            .slice(0, 5),
          errorType,
          attempt,
          previousQuestion,
        }),
      });
      const result = await response.json() as { question?: AdaptiveQuestion };
      const question = response.ok && result.question
        ? result.question
        : fallbackQuestion(node, distractorNodes, errorType);
      setQuiz({ nodeId: node.id, attempt, question });
      setSelectedAnswer(null);
      setQuizOutcome(null);
      questionStartedAt.current = Date.now();
    } catch {
      setQuiz({
        nodeId: node.id,
        attempt,
        question: fallbackQuestion(node, distractorNodes, errorType),
      });
      setSelectedAnswer(null);
      setQuizOutcome(null);
      questionStartedAt.current = Date.now();
    } finally {
      setQuizLoading("");
    }
  };

  const beginCheckpoint = (node: KnowledgeNode) => {
    const nextLocked = learningNodes.find((candidate) => !nodeProgress[candidate.id]);
    if (!progressionEnabled || quiz || quizLoading || !nextLocked || nextLocked.id !== node.id) return;
    void requestAdaptiveQuestion(node, 1);
  };

  const onReaderScroll = () => {
    const container = readerScrollRef.current;
    const nextLocked = learningNodes.find((node) => !nodeProgress[node.id]);
    if (!container || !nextLocked || quiz || quizLoading) return;
    const marker = container.querySelector<HTMLElement>(
      `[data-checkpoint-id="${CSS.escape(nextLocked.id)}"]`,
    );
    if (!marker) return;
    const containerTop = container.getBoundingClientRect().top;
    const markerTop = marker.getBoundingClientRect().top;
    if (markerTop <= containerTop + container.clientHeight * .72) beginCheckpoint(nextLocked);
  };

  const answerQuestion = (answerIndex: number) => {
    if (!quiz || selectedAnswer !== null) return;
    const correct = answerIndex === quiz.question.correctIndex;
    const latency = Math.max(400, Date.now() - questionStartedAt.current);
    const nextProfile = updateWeaknessProfile(
      weaknessProfile,
      quiz.question.errorType,
      correct,
      latency,
    );
    setWeaknessProfile(nextProfile);
    setSelectedAnswer(answerIndex);
    if (correct) {
      setNodeProgress((current) => ({ ...current, [quiz.nodeId]: "mastered" }));
      setSelected(quiz.nodeId);
      setQuizOutcome("mastered");
    } else if (quiz.attempt >= 3) {
      setNodeProgress((current) => ({ ...current, [quiz.nodeId]: "fragile" }));
      setSelected(quiz.nodeId);
      setQuizOutcome("fragile");
    } else {
      setQuizOutcome("retry");
    }
  };

  const retryCheckpoint = () => {
    if (!quiz) return;
    const node = graph.nodes.find((candidate) => candidate.id === quiz.nodeId);
    if (!node) return;
    void requestAdaptiveQuestion(node, quiz.attempt + 1, quiz.question.prompt, weaknessProfile);
  };

  const closeCheckpoint = () => {
    setQuiz(null);
    setSelectedAnswer(null);
    setQuizOutcome(null);
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
          <div><strong>Knowledge Galaxy</strong><span>read · retrieve · unlock</span></div>
        </div>
        <div className="top-actions">
          {studyNodes.length > 0 && analysisMode === "gemini" && (
            <button className="study-small" onClick={() => openFlashcard(studyNodes[0])}>Study cards</button>
          )}
          {documentPreview && (
            <button className="reader-small" onClick={() => setReaderOpen(true)}>Original file</button>
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
          <p className="eyebrow">{fileName ? "Your network grows as you read" : "Your document becomes a memory quest"}</p>
          <h1>{fileName ? graph.title : <>Read it. Recall it. <em>Unlock it.</em></>}</h1>
          <p>{fileName ? `${completedCount}/${learningNodes.length} nodes unlocked · ${graph.wordCount.toLocaleString()} source words` : "Upload a PDF or DOCX. Start with one node, then grow the map by passing source-grounded checkpoints."}</p>
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
                const clicked = closest as { id: string; distance: number } | null;
                if (clicked) {
                  const node = visibleNodes.find((candidate) => candidate.id === clicked.id);
                  if (node) jumpToNode(node.id);
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
          <div className="orbit-hint">DRAG TO ORBIT <span>·</span> SCROLL TO ZOOM <span>·</span> CLICK NODE TO JUMP IN THE READER</div>
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
          {quizLoading && <div className="processing checkpoint-loading"><i /><strong>Building a checkpoint</strong><span>Preparing a source-grounded question for {quizLoading}.</span></div>}
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
                  {documentText && <button onClick={() => { setFlashcardId(null); jumpToNode(flashcardNode.id); }}>Jump to source</button>}
                  <button onClick={() => moveFlashcard(1)}>Next →</button>
                </footer>
              </article>
            </div>
          )}
        </div>

        <section className="reading-pane" aria-label="Document reading canvas">
          <header className="reading-head">
            <div>
              <span>Reading canvas</span>
              <strong>{fileName || "Upload a source to begin"}</strong>
            </div>
            {progressionEnabled && (
              <div className="reading-progress">
                <b>{completedCount}/{learningNodes.length}</b>
                <span>nodes</span>
              </div>
            )}
          </header>
          <div className="progress-track" aria-hidden="true">
            <i style={{ width: `${learningNodes.length ? (completedCount / learningNodes.length) * 100 : 0}%` }} />
          </div>
          <div className="reading-scroll" ref={readerScrollRef} onScroll={onReaderScroll}>
            {readerParagraphs.length ? (
              <article className="reading-document">
                <div className="reading-cover">
                  <span>Closed-document quest</span>
                  <h2>{graph.title}</h2>
                  <p>Read naturally. A checkpoint appears as you reach each marked passage; pass it to grow the network.</p>
                </div>
                {readerParagraphs.map((paragraph, index) => (
                  <section className={/^\[PAGE \d+\]$/.test(paragraph) ? "page-marker" : "reading-paragraph"} key={`${index}-${paragraph.slice(0, 18)}`}>
                    {(checkpointsByParagraph.get(index) ?? []).map((node) => {
                      const status = nodeProgress[node.id];
                      const nextLocked = learningNodes.find((candidate) => !nodeProgress[candidate.id]);
                      return (
                        <button
                          className={`reader-checkpoint ${status || "locked"}`}
                          data-checkpoint-id={node.id}
                          key={node.id}
                          onClick={() => status ? jumpToNode(node.id) : nextLocked?.id === node.id ? beginCheckpoint(node) : undefined}
                        >
                          <i />
                          <span>{status === "mastered" ? "Unlocked" : status === "fragile" ? "Needs practice" : "Checkpoint"}</span>
                          <b>{node.label}</b>
                        </button>
                      );
                    })}
                    {/^\[PAGE \d+\]$/.test(paragraph) ? <span>{paragraph.replace(/\[|\]/g, "")}</span> : <p>{paragraph}</p>}
                  </section>
                ))}
              </article>
            ) : (
              <div className="reading-empty">
                <span>01</span>
                <h2>Your source becomes the path.</h2>
                <p>Upload a PDF or DOCX. The readable text appears here while the network begins with only its central node.</p>
                <button onClick={() => inputRef.current?.click()}>Choose document</button>
              </div>
            )}
          </div>
          {progressionEnabled && (
            <footer className="adaptive-status">
              <span>Adaptive focus</span>
              <b>{weakestErrorTypes(weaknessProfile)[0].replace("-", " ")}</b>
              <em>Private on this device</em>
            </footer>
          )}
        </section>

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
          {progressionEnabled && selectedNode.id !== "topic" && (
            <div className={`mastery-pill ${nodeProgress[selectedNode.id] || "locked"}`}>
              {nodeProgress[selectedNode.id] === "mastered" ? "Mastered" : nodeProgress[selectedNode.id] === "fragile" ? "Needs practice" : "Locked"}
            </div>
          )}
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
                <button key={`${edge.from}-${edge.to}-${index}`} onClick={() => other && jumpToNode(other.id)}>
                  <i /><b>{other?.label}</b><em>{edge.relation}</em>
                </button>
              );
            })}
          </div>
          <div className="legend"><span><i /> hierarchy</span><span><i className="dashed" /> knowledge connection</span></div>
        </aside>
      </section>

      {draggingFile && <div className="drop-overlay"><strong>Drop the document</strong><span>PDF or DOCX · closed-document analysis</span></div>}
      {quiz && (
        <div className="quiz-overlay" role="dialog" aria-modal="true" aria-label="Reading checkpoint">
          <article className="quiz-card">
            <header>
              <div>
                <span>Reading checkpoint</span>
                <strong>{graph.nodes.find((node) => node.id === quiz.nodeId)?.label}</strong>
              </div>
              <div className="attempt-meter" aria-label={`Attempt ${quiz.attempt} of 3`}>
                {[1, 2, 3].map((attempt) => <i className={attempt <= quiz.attempt ? "active" : ""} key={attempt} />)}
              </div>
            </header>
            <div className="quiz-signal">
              <span>Adaptive skill</span>
              <b>{quiz.question.errorType.replace("-", " ")}</b>
            </div>
            <h2>{quiz.question.prompt}</h2>
            <div className="quiz-choices">
              {quiz.question.choices.map((choice, index) => {
                const correctChoice = selectedAnswer !== null && index === quiz.question.correctIndex;
                const wrongChoice = selectedAnswer === index && index !== quiz.question.correctIndex;
                return (
                  <button
                    className={correctChoice ? "correct" : wrongChoice ? "wrong" : ""}
                    disabled={selectedAnswer !== null}
                    key={`${choice}-${index}`}
                    onClick={() => answerQuestion(index)}
                  >
                    <span>{String.fromCharCode(65 + index)}</span>
                    <b>{choice}</b>
                  </button>
                );
              })}
            </div>
            {quizOutcome && (
              <div className={`quiz-feedback ${quizOutcome}`}>
                <span>{quizOutcome === "mastered" ? "Node unlocked" : quizOutcome === "fragile" ? "Unlocked for review" : "Retrieval correction"}</span>
                <p>{quiz.question.explanation}</p>
                {quizOutcome === "retry" ? (
                  <button onClick={retryCheckpoint}>Try a different question · {quiz.attempt + 1}/3</button>
                ) : (
                  <button onClick={closeCheckpoint}>{quizOutcome === "mastered" ? "Grow the network" : "Continue with a grey node"}</button>
                )}
              </div>
            )}
            {!quizOutcome && <footer>Choose one answer. The next node stays hidden until this checkpoint is resolved.</footer>}
          </article>
        </div>
      )}
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
