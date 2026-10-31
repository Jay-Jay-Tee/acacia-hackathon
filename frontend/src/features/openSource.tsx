import type { Citation } from "../api/types";
import type { SidePanelApi } from "../components/SidePanel";
import { SourceViewer } from "./SourceViewer";

/** Citation chip clicked: open the full source in the side panel, scrolled to the cited passage. */
export function openSource(citation: Citation, panel: SidePanelApi) {
  panel.open({
    title: `Source · ${citation.ad_number || citation.docket}`,
    // key resets the viewer's state when another chip is clicked while the panel is open
    body: <SourceViewer key={citation.chunk_id} citation={citation} />,
  });
}
