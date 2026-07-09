import type { InterpolationKind } from './InterpolationKind.ts'

/*
Classifies a `computed`/`linked` SEED expression from its checker type, keyed by the
seed's source offset (`loc`) and verbatim `code` — the cell-transform counterpart of
`InterpolationClassifier` (ADR-0023). Built by the bundler plugin over the SAME warm
shadow program and threaded, OPTIONAL, through the compile front-end to `desugarSignals`.

Unlike `InterpolationClassifier`, a resolution failure returns `undefined`, NOT `'sync'`:
for a seed, fail-open means degrade to today's `isBareCallComputed` syntax heuristic, so a
failure must be DISTINGUISHABLE from a genuine `sync` type (which routes to the lazy
`derive` slot). Absent classifier ⇒ every seed resolves `undefined` ⇒ exactly today's
behavior.
*/
export type SeedTypeClassifier = (loc: number, code: string) => InterpolationKind | undefined
