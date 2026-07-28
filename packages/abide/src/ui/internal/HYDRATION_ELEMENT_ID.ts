// The two element ids the SSR document commits to and the client bundle looks up by name — the only
// coupling points between `server/internal/pages.ts` (which WRITES the document shell) and the browser
// entry (which READS it):
//
//   • `container` — the `<div>` wrapping the page's inner HTML. What `hydrate` claims, what a soft-nav
//                   swaps its shell into, and what `HYDRATED_ATTRIBUTE` is stamped on.
//   • `seed`      — the `<script type="application/json">` carrying the §5 hydration seed (recorded
//                   reads, state initials, stream handles).
//
// Both were spelled three times: as `CONTAINER_ID`/`SEED_ID` in `bootstrap.ts`, as a second private
// `CONTAINER_ID` in `navigate.ts`, and as raw literals in `documentHead`/`documentTail`. A rename on
// the server side alone yields a document that renders correctly and hydrates into nothing — the
// lookup returns `null` and the bootstrap has nowhere to attach.
export const HYDRATION_ELEMENT_ID = { container: '__abide-app', seed: '__abide-seed' } as const
