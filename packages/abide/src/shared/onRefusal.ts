// 37.22-37.27 — THE BROWSER'S `onRefusal`: filed as the browser's `onError` is, and handed every
// refusal a call over http is answered with in this browser — a refusal settles as the value's
// `error` rather than throwing, so `onError` never hears one a page read.
//
// HANDED WHERE AN ANSWER BECOMES A `Failed`, `answered` in `answerOf.ts`, which every browser call
// reads its answer through — a handler's `wire`, a handler abide mounts, and a call `outbox` sends —
// so no caller carries a branch of its own. An aborted call is never answered (16.49), and a call
// 16.81 settles to a stand-in is not refused.

import { BrowserHooks } from './BrowserHooks.ts'
import type { Failed } from './Failed.ts'
import { untracked } from './reactive/tracking.ts'
import type { Method } from './rpc.ts'

export type RefusedCall = { method: Method; url: string }

const HOOKS = new BrowserHooks<
    [refusal: Failed<string, unknown>, call: RefusedCall]
>(
    'onRefusal',
    "abide: onRefusal files only in a component's <script>. RULEBOOK 37.23.",
)

/** Files `hook` for every refusal a call is answered with while the calling component stands; returns what unfiles it. */
export function onRefusal(
    hook: (refusal: Failed<string, unknown>, call: RefusedCall) => unknown,
): () => void {
    return HOOKS.file(hook)
}

/** 37.24 — hands `refusal`, the answer to `call`, to every `onRefusal` filed. */
export function refused(
    refusal: Failed<string, unknown>,
    call: RefusedCall,
): void {
    if (HOOKS.empty()) return
    // UNTRACKED: an answer the server painted settled is read inside the value's body (41.27), and a
    // hook's read there would subscribe that value to whatever the hook reads.
    untracked(handRefused, refusal, { method: call.method, url: call.url })
}

function handRefused(
    refusal: Failed<string, unknown>,
    call: RefusedCall,
): void {
    HOOKS.hand(refusal, call)
}
