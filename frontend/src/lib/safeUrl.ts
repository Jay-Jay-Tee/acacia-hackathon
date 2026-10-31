// Contract rule (docs/API.md): only links to the Federal Register may be rendered.
const ALLOWED_PREFIX = "https://www.federalregister.gov/";

export function safeUrl(url: unknown): string | null {
  if (typeof url !== "string" || !url.startsWith(ALLOWED_PREFIX)) return null;
  try {
    // Reject anything the URL parser would resolve to another origin.
    return new URL(url).origin === "https://www.federalregister.gov" ? url : null;
  } catch {
    return null;
  }
}
