import type { SidePanelApi } from "../components/SidePanel";
import { WhatChanged } from "./WhatChanged";

/** Open "what changed" for a notice: compared with `oldAdId`, or with the previous notice in its docket. */
export function openWhatChanged(newAdId: number, panel: SidePanelApi, oldAdId?: number) {
  panel.open({
    title: "What changed",
    body: <WhatChanged key={`${oldAdId ?? "prev"}-${newAdId}`} newId={newAdId} oldId={oldAdId} />,
  });
}
