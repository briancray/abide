import { CURRENT_SCOPE } from '../runtime/CURRENT_SCOPE.ts'
import { inScope } from '../runtime/inScope.ts'
import { OWNER } from '../runtime/OWNER.ts'
import { toTeardown } from '../runtime/toTeardown.ts'
import type { EffectResult } from '../runtime/types/EffectResult.ts'

/*
Runs an attachment against an element at build time and registers its optional
teardown with the current ownership scope, so it detaches when the component
disposes. The dual of `on`: where `on` owns a listener, `attach` owns whatever
the attachment sets up. Node-lifetime, not reactive — for param reactivity put an
`effect` inside the attachment and return its dispose. The attachment may be
async; its teardown then runs once the promise settles. Runtime target for an
`attach={…}` binding.
*/
// @readme plumbing
export function attach(element: Element, attachment: (node: Element) => EffectResult): void {
    /* The attachment body runs now (scope already current); pin the teardown, which
       fires on dispose, so an ambient `scope()` in it resolves the component. */
    const captured = CURRENT_SCOPE.current
    const teardown = toTeardown(attachment(element))
    if (teardown !== undefined && OWNER.current !== undefined) {
        OWNER.current.push(() => inScope(captured, teardown))
    }
}
