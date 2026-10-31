import type { SidePanelApi } from "../components/SidePanel";
import { WatchlistPanel } from "./WatchlistPanel";

/** Open the watchlist of dockets. P1 calls this from a header button via `features.openWatchlist`. */
export function openWatchlist(panel: SidePanelApi) {
  panel.open({ title: "Watchlist", body: <WatchlistPanel /> });
}
