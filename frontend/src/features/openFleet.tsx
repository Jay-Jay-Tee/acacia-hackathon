import type { SidePanelApi } from "../components/SidePanel";
import { FleetCheck } from "./FleetCheck";

/** Open the fleet check in the side panel. P1 calls this from a button via `features.openFleetCheck`. */
export function openFleetCheck(panel: SidePanelApi) {
  panel.open({ title: "Fleet check", body: <FleetCheck /> });
}
