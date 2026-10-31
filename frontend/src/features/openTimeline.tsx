import type { SidePanelApi } from "../components/SidePanel";
import { openWhatChanged } from "./openChanges";
import { RevisionTimeline } from "./RevisionTimeline";

/** Open the docket's revision timeline in the side panel. P1 calls this from a document card via `features.openRevisionTimeline`. */
export function openRevisionTimeline(adId: number, panel: SidePanelApi) {
  panel.open({
    title: "Revision timeline",
    // key resets the component's state when another timeline is opened while the panel is open
    body: (
      <RevisionTimeline
        key={adId}
        adId={adId}
        onOpenAd={(id) => openRevisionTimeline(id, panel)}
        onCompare={(id) => openWhatChanged(id, panel)}
      />
    ),
  });
}
