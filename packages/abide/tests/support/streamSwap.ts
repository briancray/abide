import { SSR_SWAP_SCRIPT } from '../../src/lib/server/runtime/SSR_SWAP_SCRIPT.ts'

/*
Runs the REAL production inline swap script — `SSR_SWAP_SCRIPT`'s `__abideSwap`, the exact
code the SSR stream ships in <head> and the browser runs after each streamed
`<abide-resolve>` fragment. Tests drive the streaming-await/hydrate path through THIS
(not a hand-rolled twin) so they exercise the shipped swap code itself.

`window` is bound to `globalThis` so the script's `window.__abideResume` IS the object the
framework's RESUME manifest reads (in a browser `window === globalThis`; the happy-dom test
env splits them, so we re-unify here). `document` / `NodeFilter` inside the script resolve
to the happy-dom globals `installHappyDom` publishes — so a real DOM (querySelector,
createTreeWalker, NodeFilter) is REQUIRED; this does not work under the mini-dom.
*/
const abideSwap = new Function('window', `${SSR_SWAP_SCRIPT}\nreturn __abideSwap`)(
    globalThis,
) as () => void

/* Drive one streamed chunk the way the browser does: parse the `<abide-resolve>` fragment
   into document.body (where the stream lands it), then run the inline swap — which reads its
   resume payload into `RESUME[id]` and swaps the resolved markup into the matching
   `<!--abide:await:ID-->…<!--/abide:await:ID-->` boundary, removing the fragment. */
export function streamSwap(chunk: string): void {
    document.body.insertAdjacentHTML('beforeend', chunk)
    abideSwap()
}
