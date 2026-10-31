// Parse pasted or uploaded `model,serial` rows. Tolerates a header row, tab/semicolon separators,
// quoted cells and blank lines. Limits mirror the API (40 chars per field, 500 aircraft).
import type { FleetRow } from "./fleetApi";

export const MAX_FLEET = 500;
const MAX_FIELD = 40;

function splitLine(line: string): string[] {
  const delim = line.includes("\t") ? "\t" : line.includes(",") ? "," : line.includes(";") ? ";" : ",";
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delim) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

export function parseFleetCsv(text: string): { rows: FleetRow[]; errors: string[] } {
  const rows: FleetRow[] = [];
  const errors: string[] = [];
  let seenFirst = false;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const [model = "", serial = ""] = splitLine(lines[i]);
    const first = !seenFirst;
    seenFirst = true;
    if (first && model.toLowerCase() === "model") continue; // header row
    if (!model) {
      errors.push(`Line ${i + 1}: model is missing, row skipped.`);
    } else if (model.length > MAX_FIELD || serial.length > MAX_FIELD) {
      errors.push(`Line ${i + 1}: model or serial is longer than ${MAX_FIELD} characters, row skipped.`);
    } else if (rows.length >= MAX_FLEET) {
      errors.push(`Only the first ${MAX_FLEET} aircraft are checked; the rest were ignored.`);
      break;
    } else {
      rows.push({ model, serial });
    }
  }
  return { rows, errors };
}
