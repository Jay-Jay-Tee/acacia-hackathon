# src/features (owned by P4)

P4's components live here, so P1 and P4 never edit the same files.

How to plug in:
- **Side panel:** call `useSidePanel().open({ title, body })` from `../components/SidePanel` to show any component in the right-hand slot. `Esc` or ✕ closes it.
- **Citation clicks:** set `features.onCitationClick` in `index.ts`. P1's citation chips call it with the full `Citation` (including `ad_id` and `chunk_id`) and the panel API. Until it's set, clicking a chip opens the Federal Register source in a new tab.
- **API types:** import from `../api/types` (mirrors `docs/API.md`). Add new endpoint calls in your own file here rather than in `../api/client.ts`.

Same rules as the rest of the UI: no `dangerouslySetInnerHTML`, and links go through `safeUrl()` from `../lib/safeUrl`.

If you need a new hook (for example a button in the document card), ask P1 to add it to `FeatureHooks`.
