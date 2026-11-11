// 34.32 — A `<script>` SETUP'S `NotLanded`, named as the setup's. The setup and what follows it
// share one `try`, since the names a setup declares are read by the markup after it and a block of
// its own would hide them; a flag cleared between the two is what says which of them threw.

import type { Lowering } from './Lowering.ts'

/** The flag a setup's `try` reads to tell a throw from the setup apart from one after it. */
export const IN_SETUP = '__inSetup'

/** What a setup's `catch` rethrows (`setupThrown`), with the caught value bound to `thrown`. */
export function setupRethrow(lowering: Lowering): string {
    return `throw ${lowering.use('setupThrown')}(thrown, ${IN_SETUP})`
}

/** `setup` then `rest`, inside the `try` that names a setup's read of an unlanded value. */
export function guardedSetup(
    lowering: Lowering,
    setup: string,
    rest: string,
): string {
    if (setup.trim() === '') return rest
    return `let ${IN_SETUP} = true
try {
${setup}
${IN_SETUP} = false
${rest}
} catch (thrown) { ${setupRethrow(lowering)} }`
}
