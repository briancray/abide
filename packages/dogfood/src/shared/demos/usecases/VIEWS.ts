// The view per use case — what `/demos/<name>` actually mounts.
//
// A RECORD and not a branch chain, which is worth saying because the page carried the opposite claim
// for a while: a `<Name/>` TAG is resolved syntactically — that is what keeps the emit path off the
// type-checker — but the rule constrains the tag, not what the identifier behind it holds. `<View/>`
// on a local `const View = VIEWS[name]` emits `component(View, …)` exactly as a literal tag does, so
// six components indexed by name is a lookup and never had to be six branches.
//
// The third of three modules keyed by the same names, and the split between them is a bundling one:
// `USECASES.ts` is a leaf the `/demos` index reads, `SOURCES.ts` is ~48 kB of file text and this is
// six compiled views. Only `/demos/[name]` takes the last two, which is why the index chunk is a list
// of links rather than every demo and every demo's source. All three are gated against each other in
// `#tests/unit/usecases.test.ts`, in both directions — a name in one and not another is a page that
// renders a demo with no source, or an address with nothing to mount.
//
// WHAT IT COSTS is one route chunk carrying all six views, because a record's values are all reachable
// however the name resolves. That is a lazy route chunk rather than the client entry — the first load
// `build.test.ts` gates is untouched by it — and the alternative was a per-name dynamic import, which
// server-renders the demo and then finds it PENDING on the client, rebuilding the subtree hydration
// had just been handed correct markup for.

import type { TemplateResult } from 'abide'
import Complex from './Complex.abide'
import Dashboard from './Dashboard.abide'
import Data from './Data.abide'
import Media from './Media.abide'
import Simple from './Simple.abide'
import Wake from './Wake.abide'

/** A compiled `.abide` component taking nothing but its children — which is every view here. */
export type View = (args: { children?: unknown }) => TemplateResult

export const VIEWS: Record<string, View> = {
    simple: Simple,
    dashboard: Dashboard,
    complex: Complex,
    media: Media,
    data: Data,
    wake: Wake,
}
