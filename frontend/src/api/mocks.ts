import type { AskRequest, AskResponse } from "./types";

// Canned /ask responses for building the UI without the backend.
//  - src/mocks/*.json: captured from the real backend (no API key, so extractive mode),
//    except edge_synthetic.json, which is hand-built to hit every badge and the XSS cases.
//  - ../fixtures/ask_*.json (P3, repo root): picked up automatically once committed; same name wins.
// Each file is {"request": AskRequest, "response": AskResponse}.
type Fixture = { request: AskRequest; response: AskResponse };

// The DEV guard keeps the JSON out of the production bundle.
const files: Record<string, Fixture> = import.meta.env.DEV
  ? {
      ...import.meta.glob<Fixture>("../mocks/*.json", { eager: true, import: "default" }),
      ...import.meta.glob<Fixture>("../../../fixtures/ask_*.json", { eager: true, import: "default" }),
    }
  : {};

export const mocks: Record<string, Fixture> = Object.fromEntries(
  Object.entries(files).map(([path, f]) => [path.split("/").pop()!.replace(/^ask_/, "").replace(/\.json$/, ""), f]),
);

/** The response for `?mock=<name>` in the page URL, or null when not mocking. */
export function mockResponse(): AskResponse | null {
  const name = new URLSearchParams(window.location.search).get("mock");
  return name && mocks[name] ? structuredClone(mocks[name].response) : null;
}
