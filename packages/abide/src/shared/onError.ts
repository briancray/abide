// 37.16, 37.17, 37.18 — THE BROWSER'S `onError`: the name and the signature `@abide/abide/server`'s
// has, called in a `<script>` rather than a `<script server>`, and filed while the component that
// called it stands — so a layout's hears every page below it, as the server's hears every route
// below it. A server's is `#server/hooks.ts`'s, which `@abide/abide/server` exports over this one;
// this one called in a server's render files nothing.
//
// WHAT NOTHING CAUGHT IS THE BROWSER'S OWN ACCOUNT: the window's `error` event and its
// `unhandledrejection`, which a call's refusal no handler awaited or caught arrives as. 12.6's
// throws are handed through `UNEXPECTED` as they are on a server, and the one of them that then
// surfaces as uncaught (12.7) is not handed a second time. An abort is handed to none (37.28).

import { BrowserHooks } from './BrowserHooks.ts'
import { isAbort } from './isAbort.ts'
import { UNEXPECTED } from './UNEXPECTED.ts'

const HOOKS = new BrowserHooks<[error: unknown]>(
    'onError',
    "abide: onError of `@abide/abide` files only in a component's <script>; a <script server> or a server module files the server's, of `@abide/abide/server`. RULEBOOK 37.21.",
    listen,
)

// What 12.6 handed and 12.7 may yet surface as uncaught, held until the task that handed it is over.
const SURFACING: unknown[] = []

/** Files `hook` for every failure nothing caught while the calling component stands; returns what unfiles it. */
export function onError(hook: (error: unknown) => unknown): () => void {
    return HOOKS.file(hook)
}

function listen(): void {
    // A SERVER'S SLOT IS LEFT AS IT IS: a test with a document and a server has both lanes.
    UNEXPECTED.report ??= handedUnexpected
    addEventListener('error', (event) => surfaced((event as ErrorEvent).error))
    addEventListener('unhandledrejection', (event) =>
        surfaced((event as PromiseRejectionEvent).reason),
    )
}

function handedUnexpected(error: unknown): void {
    if (SURFACING.length === 0) setTimeout(() => (SURFACING.length = 0))
    SURFACING.push(error)
    hand(error)
}

function surfaced(error: unknown): void {
    const at = SURFACING.indexOf(error)
    if (at !== -1) {
        SURFACING.splice(at, 1)
        return
    }
    hand(error)
}

// 37.28 — every browser route to the hooks passes here, so an abort reaches none of them.
function hand(error: unknown): void {
    if (!isAbort(error)) HOOKS.hand(error)
}
