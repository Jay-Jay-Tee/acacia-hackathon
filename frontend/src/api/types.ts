// TypeScript mirror of docs/API.md (contract v1 + v1.1 additions).
// Shared by P1 (UI) and P4 (features). Change only together with docs/API.md.

// ---------- POST /ask ----------

export interface AskRequest {
  query: string; // required, <= 500 chars
  model?: string | null; // <= 40 chars
  serial?: string | null; // <= 40 chars
}

export type AskStatus = "answered" | "refused" | "needs_clarification";

/** null when the request was refused before the LLM ran. */
export type AnswerMode = "generated" | "extractive" | "no_answer" | null;

export interface Citation {
  docket: string;
  ad_number: string; // "" for NPRMs
  revision_date: string;
  section: string;
  fr_citation: string;
  page: number;
  url: string;
  cited_text: string;
  ad_id: number;
  chunk_id: number; // v1: lets the source viewer jump to the passage
}

export interface AnswerBlock {
  text: string; // one cited claim
  citations: Citation[];
}

export type DocStatus = "proposed" | "final" | "withdrawn";

export type ModelsSource = "sheet" | "applicability" | "summary" | null;

export interface RevisionVersion {
  id: number;
  issue_date: string;
  status: string;
  citation: string;
  url: string;
}

export interface Revision {
  count: number;
  is_latest: boolean;
  latest_id: number;
  versions: RevisionVersion[];
}

export type ApplicabilityResult = "APPLIES" | "DOES_NOT_APPLY" | "UNKNOWN" | "AMBIGUOUS";

export interface Applicability {
  result: ApplicabilityResult;
  trace: string[];
  candidates?: string[]; // only when AMBIGUOUS
}

export interface DocumentCard {
  ad_id: number;
  docket: string;
  subject: string;
  status: DocStatus;
  issue_date: string;
  make: string;
  models: string[];
  models_source?: ModelsSource; // v1.1
  supersedes: string[];
  fulltext: boolean;
  url: string;
  citation: string;
  ad_number: string;
  revision: Revision;
  applicability: Applicability | null;
}

export interface AskResponse {
  status: AskStatus;
  mode: AnswerMode;
  refusal_reason: string; // "" when answered
  note: string;
  retrieval_ms: number;
  total_ms: number;
  disclaimer: string;
  /** v1.1 (P2, not yet on main): exact models to choose from when needs_clarification, else []. */
  candidates?: string[];
  answer_blocks: AnswerBlock[];
  documents: DocumentCard[];
}

// ---------- GET /search ----------

export interface SearchHit {
  ad_id: number;
  card: Omit<DocumentCard, "applicability">;
  [extra: string]: unknown; // hit-level fields (chunk, score, ...) are not part of the frozen contract
}

export interface SearchResponse {
  retrieval_ms: number;
  hits: SearchHit[];
}

// ---------- GET /ad/{ad_id} ----------

export interface AdDetail extends Omit<DocumentCard, "applicability"> {
  summary: string;
  applicability_text: string;
}
