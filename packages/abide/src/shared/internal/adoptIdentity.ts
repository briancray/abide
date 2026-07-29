// Adopt the principal the SERVER resolved onto the client holder, so `identity()` answers in the
// browser (the hydration seed on load and on a full soft-nav, a `/__abide/identity` fetch after a
// login mutation).
//
// Thin on purpose: the validate-or-drop rule and the identical-value guard both live on the holder
// (`identityHolder` → `adoptedAmbient`), which is where they are shared with `route()` and `trace()`.
// What stays here is only the null-check — "there was nothing to adopt", which is a different thing
// from "there was something and it was malformed", the case the holder drops.

import { setClientIdentity } from './identityHolder.ts'
import type { Principal } from './principal.ts'

export function adoptIdentity(principal: Principal | null | undefined): void {
    if (principal === null || principal === undefined) return
    setClientIdentity(principal)
}
