import type { SidePanelApi } from "../components/SidePanel";
import { UploadPanel } from "./UploadPanel";

/** Open the document upload and Q&A panel. P1 calls this from a button via `features.openUploads`. */
export function openUploads(panel: SidePanelApi) {
  panel.open({ title: "Upload a document", body: <UploadPanel /> });
}
