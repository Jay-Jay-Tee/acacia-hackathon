import type { Citation } from "../api/types";
import type { SidePanelApi } from "../components/SidePanel";
import { openFleetCheck } from "./openFleet";
import { openSource } from "./openSource";

// P4's single entry point into the UI. P1's components call these hooks; P4 fills them in
// from files under src/features/ (owned by P4). Anything left undefined falls back to
// P1's default behaviour, so the app works with this file exactly as it is.

export interface FeatureHooks {
  /** Citation chip clicked. Default when undefined: open the Federal Register source in a new tab. */
  onCitationClick?: (citation: Citation, panel: SidePanelApi) => void;
  /** Open the fleet check in the side panel. P1 wires a button to this; no button renders while undefined. */
  openFleetCheck?: (panel: SidePanelApi) => void;
}

export const features: FeatureHooks = {
  onCitationClick: openSource,
  openFleetCheck,
};
