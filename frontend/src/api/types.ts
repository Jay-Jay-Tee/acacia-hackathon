// TypeScript mirror of docs/API.md (contract v1.3).
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
  record_id: string; // v1.2: official citation key from challenge4_ad_index.xlsx
  docket: string;
  ad_number: string; // "" for NPRMs
  status: DocStatus; // v1.2
  revision_date: string; // FR publish date of this version
  section: string;
  fr_citation: string;
  pages: string; // v1.2: page range of the whole notice
  page: number; // page of the cited passage
  url: string;
  cited_text: string;
  ad_id: number;
  chunk_id: number; // v1: lets the source viewer jump to the passage
}

export interface AnswerBlock {
  text: string; // one cited claim
  citations: Citation[];
}

/** not_ad (v1.3): a non-AD rule in the sheet, e.g. 14 CFR Part 61. */
export type DocStatus = "proposed" | "final" | "withdrawn" | "not_ad";

export type ModelsSource = "sheet" | "applicability" | "summary" | null;

export interface RevisionVersion {
  id: number;
  record_id: string; // v1.2
  publish_date: string; // v1.2
  issue_date: string;
  status: string;
  citation: string;
  url: string;
}

export interface Revision {
  count: number;
  is_latest: boolean;
  latest_id: number;
  versions: RevisionVersion[]; // newest first
}

export type ApplicabilityResult = "APPLIES" | "DOES_NOT_APPLY" | "UNKNOWN" | "AMBIGUOUS";

export interface Applicability {
  result: ApplicabilityResult;
  trace: string[];
  candidates?: string[]; // only when AMBIGUOUS
}

export interface DocumentCard {
  ad_id: number;
  record_id: string; // v1.2
  docket: string;
  subject: string;
  status: DocStatus;
  status_label: string; // v1.2: display text for the status
  data_warning?: string | null; // v1.3: a known problem with this record's source data; show it
  issue_date: string;
  publish_date: string; // v1.2
  pages: string; // v1.2
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
  /** v1.1: exact models to choose from when needs_clarification, else []. */
  candidates: string[];
  /** v1.2: deterministic status reminders (e.g. "cited documents include NPRMs"); show prominently. */
  notices: string[];
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

// ---------- GET /corpus ----------

export interface CorpusStats {
  records: number;
  records_with_full_text: number;
  federal_register_pages: number;
  passages: number;
  status: Partial<Record<DocStatus, number>>;
  embeddings: boolean;
}

// ---------- GET /ad/{ad_id} ----------

export interface AdDetail extends Omit<DocumentCard, "applicability"> {
  summary: string;
  applicability_text: string;
}
