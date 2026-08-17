// What each use case is WRITTEN IN, as text.
//
// Through `?source`, which the loader inlines — never `Function.prototype.toString`, which reports the
// BUNDLER's text once the app is built and is one minified line for a whole file. The same mechanism
// `/docs` shows a rung with, for the same reason: the file on the page has to be the file on disk.
//
// APART FROM `USECASES.ts` deliberately, and the split is a bundling one. `/demos` indexes the use
// cases and needs a name, a title and a blurb; `/demos/[name]` is the only thing that needs forty
// kilobytes of source text. One module means the index chunk carries every demo's source to render a
// list of six links. Two modules is two lists that can drift, so BOTH halves are gated:
// `#tests/unit/usecases.test.ts` compares these keys against `USECASES_BY_NAME` in both directions,
// and `#tests/unit/build.test.ts` walks the index page's closure and asserts this text is not in it —
// the split without that second gate was a comment claiming a bundling property nothing measured.
//
// The VIEW first in every list, because it is what the reader just watched run. What follows it is
// what it needed to do that — the data builder, the components it composes, and for `data` the
// endpoint, which is the half a browser never receives and so the half a reader cannot infer.

import ROWS from './rows.ts?source'
import MEDIA_DATA from './media.ts?source'
import CATALOGUE from './catalogue.ts?source'
import WAKE_ARMS from './wake.ts?source'
import CARD from './Card.abide?source'
import POSTER from './Poster.abide?source'
import PROGRESS from './Progress.abide?source'
import SIMPLE from './Simple.abide?source'
import DASHBOARD from './Dashboard.abide?source'
import COMPLEX from './Complex.abide?source'
import MEDIA from './Media.abide?source'
import DATA from './Data.abide?source'
import WAKE from './Wake.abide?source'
import ENDPOINT from '#server/rpc/catalogue.ts?source'

/** One file, as a tab and a pane. Shared with `#ui/lib/Files.abide`, which is what paints it. */
export interface SourceFile {
    /** The file's own name, pathed only where the path is the point — see `server/rpc/catalogue.ts`. */
    label: string
    source: string
}

export const SOURCES: Record<string, SourceFile[]> = {
    simple: [
        { label: 'Simple.abide', source: SIMPLE },
        { label: 'rows.ts', source: ROWS },
    ],
    dashboard: [
        { label: 'Dashboard.abide', source: DASHBOARD },
        { label: 'Card.abide', source: CARD },
        { label: 'rows.ts', source: ROWS },
    ],
    complex: [
        { label: 'Complex.abide', source: COMPLEX },
        { label: 'rows.ts', source: ROWS },
    ],
    media: [
        { label: 'Media.abide', source: MEDIA },
        { label: 'Poster.abide', source: POSTER },
        { label: 'Progress.abide', source: PROGRESS },
        { label: 'media.ts', source: MEDIA_DATA },
    ],
    data: [
        { label: 'Data.abide', source: DATA },
        // PATHED, because the path is the whole fact: a module under `server/rpc/**` elides to its
        // address in the client lane, which is what makes the call above a keyed memo rather than a
        // fetch somebody wrote. A reader who cannot see where this file sits cannot see that.
        { label: 'server/rpc/catalogue.ts', source: ENDPOINT },
        { label: 'catalogue.ts', source: CATALOGUE },
    ],
    wake: [
        { label: 'Wake.abide', source: WAKE },
        { label: 'wake.ts', source: WAKE_ARMS },
    ],
}
