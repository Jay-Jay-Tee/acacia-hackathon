import type { AdDetail, AskRequest, AskResponse, CorpusStats, SearchResponse } from "./types";
import { mockResponse } from "./mocks";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new ApiError(`${init?.method ?? "GET"} ${path} failed (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`, res.status);
  }
  return res.json() as Promise<T>;
}

/**
 * POST /ask. Add `?mock=<name>` to the page URL to get a canned response instead
 * (see src/api/mocks.ts), so the UI can be built without the backend running.
 */
export function ask(body: AskRequest, signal?: AbortSignal): Promise<AskResponse> {
  const mock = mockResponse();
  if (mock) return Promise.resolve(mock);
  return request<AskResponse>("/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: body.query, model: body.model || null, serial: body.serial || null }),
    signal,
  });
}

export function search(q: string, model?: string, signal?: AbortSignal): Promise<SearchResponse> {
  const params = new URLSearchParams({ q });
  if (model) params.set("model", model);
  return request<SearchResponse>(`/search?${params}`, { signal });
}

export function getAd(adId: number, signal?: AbortSignal): Promise<AdDetail> {
  return request<AdDetail>(`/ad/${encodeURIComponent(adId)}`, { signal });
}

export function getCorpus(signal?: AbortSignal): Promise<CorpusStats> {
  return request<CorpusStats>("/corpus", { signal });
}
