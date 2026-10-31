import type { ComponentType } from "react";
import type { Citation } from "../api/types";
import type { SidePanelApi } from "../components/SidePanel";
import { CopyNoteButton, type CopyNoteProps } from "./CopyNoteButton";
import { openFleetCheck } from "./openFleet";
import { openSource } from "./openSource";
import { openRevisionTimeline } from "./openTimeline";

// P4's single entry point into the UI. P1's components call these hooks; P4 fills them in
// from files under src/features/ (owned by P4). Anything left undefined falls back to
// P1's default behaviour, so the app works with this file exactly as it is.

export interface FeatureHooks {
  /** Citation chip clicked. Default when undefined: open the Federal Register source in a new tab. */
  onCitationClick?: (citation: Citation, panel: SidePanelApi) => void;
  /** Open the fleet check in the side panel. P1 wires a button to this; no button renders while undefined. */
  openFleetCheck?: (panel: SidePanelApi) => void;
  /** Open a docket's revision timeline (pass any ad_id in the docket). P1 wires this to a document card's revision badge. */
  openRevisionTimeline?: (adId: number, panel: SidePanelApi) => void;
  /** "Copy as compliance note" button. P1 renders `<features.CopyNote query model serial response />` under an answer. */
  CopyNote?: ComponentType<CopyNoteProps>;
}

export const features: FeatureHooks = {
  onCitationClick: openSource,
  openFleetCheck,
  openRevisionTimeline,
  CopyNote: CopyNoteButton,
};
