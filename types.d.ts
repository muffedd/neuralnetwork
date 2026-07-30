declare module "mammoth/mammoth.browser" {
  export function extractRawText(options: { arrayBuffer: ArrayBuffer }): Promise<{ value: string }>;
  export function convertToHtml(options: { arrayBuffer: ArrayBuffer }): Promise<{ value: string }>;
}

interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

type D1Database = any;

declare module "cloudflare:workers" {
  export const env: {
    DB?: D1Database;
    [key: string]: unknown;
  };
}
