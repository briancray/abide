// 34.32 — A `<script>` SETUP THAT READ A VALUE STILL IN FLIGHT. A setup tracks nothing (14.7, 14.8),
// so there is no body for 2.12 to abort and nothing 2.13 would rerun: the `NotLanded` is not "not yet"
// here, it is a read that will never be made again. Let through as one, it said only `reactive has
// not landed` from wherever the instance was mounted — a router's travel, an arm's swap — and an
// arm's watch took it for an abort and dropped the arm without a word (`watchTracked`).
//
// ONLY A THROW FROM THE SETUP ITSELF. The emitted flag is cleared once the setup has run, so a
// `NotLanded` out of the markup after it is left as it is, for whatever guards that position.

import { NotLanded } from './reactive/NotLanded.ts'

/** What a setup's `try` rethrows: `thrown`, or the error naming a setup's read of an unlanded value. */
export function setupThrown(thrown: unknown, inSetup: boolean): unknown {
    if (!inSetup || !(thrown instanceof NotLanded)) return thrown
    return new Error(
        `abide: a <script> setup read a value that has not landed (${thrown.message}). A setup runs once and tracks nothing (RULEBOOK 14.7), so nothing runs it again when the value lands — read the value in the markup, or derive from it with reactive(() => …), and that reruns when it lands. RULEBOOK 34.32.`,
        { cause: thrown },
    )
}
