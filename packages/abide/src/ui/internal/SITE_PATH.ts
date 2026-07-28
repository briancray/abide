// The GRAMMAR of a hydration-seed site path — the key under which one component instance's `state()`
// initials are bucketed. Two segment forms, appended to the enclosing path:
//
//   • `/<siteId>` — a `<Component/>` invocation. `siteId` is assigned by `templatePlan` and read by
//                   BOTH emitters, so it names the same invocation on both sides.
//   • `#<index>`  — one `{#for}` iteration, so a branch-local `<script>` in the body records per ITEM
//                   rather than into one shared ordinal sequence.
//
// The RECORDER (`server/internal/pages.ts` `makeRecordingState`) and the REPLAYER
// (`ui/internal/seededState.ts` `makeSeededState`) each used to build these strings with their own
// template literals. They are a wire format between two processes, and a drift in either separator has
// no failure mode: the replayer looks up a key the recorder never wrote, misses, and falls back to the
// literal initial — a WRONG VALUE with no hydration mismatch to catch it, exactly the class of bug
// site-keying was introduced to kill. So the join lives here once and both sides call it.
export const SITE_PATH = {
    // The page/root bucket. The page and all its layouts share it.
    root: '',
    forSite: (sitePath: string, siteId: number): string => `${sitePath}/${siteId}`,
    forItem: (sitePath: string, index: number): string => `${sitePath}#${index}`,
} as const
