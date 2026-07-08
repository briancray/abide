import type { InterpolationKind } from './InterpolationKind.ts'

/*
Classifies a text-position `{expr}` interpolation from its checker type, keyed by
the expression's source offset (`loc`) and verbatim `code`. Built by the bundler
plugin over a warm shadow program (see `abideUiPlugin`) and threaded, OPTIONAL,
through the compile front-end: when absent the pipeline behaves exactly as before
(every interpolation binds as a plain value). Always fail-open — a resolution
failure returns `'sync'`, never throws — so a type hiccup degrades to today's
behavior instead of breaking the build.
*/
export type InterpolationClassifier = (loc: number, code: string) => InterpolationKind
