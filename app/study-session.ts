import type { KnowledgeGraph } from "./document-graph";
import type { NodeProgress } from "./learning-engine";

export type StudySession = {
  version: 1;
  fileName: string;
  documentText: string;
  graph: KnowledgeGraph;
  nodeProgress: Record<string, NodeProgress>;
  checkpointAttempts: Record<string, number>;
  savedAt: number;
};

const DATABASE_NAME = "knowledge-galaxy-study";
const STORE_NAME = "sessions";
const LATEST_SESSION_KEY = "latest";

function openStudyDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadStudySession(): Promise<StudySession | null> {
  if (typeof window === "undefined" || !window.indexedDB) return null;
  const database = await openStudyDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(LATEST_SESSION_KEY);
    request.onsuccess = () => resolve((request.result as StudySession | undefined) ?? null);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
  });
}

export async function saveStudySession(session: StudySession): Promise<void> {
  if (typeof window === "undefined" || !window.indexedDB) return;
  const database = await openStudyDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(session, LATEST_SESSION_KEY);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error);
  });
}
