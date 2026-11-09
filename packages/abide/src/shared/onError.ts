// 37.16, 37.17, 37.18 — THE BROWSER'S `onError`: the name and the signature `@abide/abide/server`'s
// has, called in a `<script>` rather than a `<script server>`, and filed while the component that
// called it stands — so a layout's hears every page below it, as the server's hears every route
// below it. A server's is `#server/hooks.ts`'s, which `@abide/abide/server` exports over this one;
// this one called in a server's render files nothing.
//
// WHAT NOTHING CAUGHT IS THE BROWSER'S OWN ACCOUNT: the window's `error` event and its
// `unhandledrejection`, which a call's refusal no handler awaited or caught arrives as. 12.6's
// throws are handed through `UNEXPECTED` as they are on a server, and the one of them that then
// surfaces as uncaught (12.7) is not handed a second time.

import { namedLogger } from './log.ts'
import { SCOPING } from './reactive/scoping.ts'
import { owned, settingUp } from './reactive/watch.ts'
import { UNEXPECTED } from './UNEXPECTED.ts'

type Filed = { hook: (error: unknown) => unknown }

// IN THE ORDER FILED, which is outermost first: a layout's setup runs before the page inside it.
const FILED: Filed[] = []

// What 12.6 handed and 12.7 may yet surface as uncaught, held until the task that handed it is over.
const SURFACING: unknown[] = []

const LIFECYCLE_LOG = namedLogger('abide:lifecycle')

let listening = false

/** Files `hook` for every failure nothing caught while the calling component stands; returns what unfiles it. */
export function onError(hook: (error: unknown) => unknown): () => void {
    if (!settingUp()) {
        // ONLY A BROWSER COLLECTS A SETUP, so a server's render — in a process with a document or
        // without one — files nothing.
        if (SCOPING.provider?.serving() === true) return () => {}
        // 37.21 — ANYWHERE ELSE IT COULD NEVER FILE: a `<script server>` or a server module wanted
        // the server's, and a call outside a component's setup has nothing to stand for.
        throw new Error(
            "abide: onError of `@abide/abide` files only in a component's <script>; a <script server> or a server module files the server's, of `@abide/abide/server`. RULEBOOK 37.21.",
        )
    }
    if (!listening) listen()
    const entry: Filed = { hook }
    FILED.push(entry)
    return owned(() => {
        const at = FILED.indexOf(entry)
        if (at !== -1) FILED.splice(at, 1)
    })
}

function listen(): void {
    listening = true
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

// 37.17 — NEAREST FIRST, which is the last filed. A hook that throws is written rather than handed
// on, where it would surface as uncaught and be handed back here.
function hand(error: unknown): void {
    for (let at = FILED.length - 1; at >= 0; at -= 1) {
        // A hook that unfiled one on its way leaves the walk past the end.
        const entry = FILED[at]
        if (entry === undefined) continue
        try {
            entry.hook(error)
        } catch (thrown) {
            LIFECYCLE_LOG.error('an onError hook threw', thrown)
        }
    }
}
