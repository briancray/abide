// The write half of `identity()` (auth.md AU3.3): apply a login or a logout to one request.
//
// `identity.set()`/`clear()` are isomorphic in NAME only — sealing an identity needs the secret and the
// response, so the behaviour lives here and is installed onto the request's reactive scope by
// `runInScope`. `shared/identity.ts` calls whatever it finds there and throws when it finds nothing,
// which is exactly the client case.
//
// Writes BOTH copies of the principal in one place: the reactive scope's (what every `identity()` read
// sees, server and client alike) and the request scope's (what the router seals into the cookie). Two
// mirrors are safe only because there is one writer — this function.

import { anonymousPrincipal } from '../../shared/internal/anonymousPrincipal.ts'
import type { Principal } from '../../shared/internal/principal.ts'
import type { ReactiveScope } from '../../shared/internal/reactiveScope.ts'
import { requireSecretForAuthedSet } from './auth.ts'
import type { RequestScope } from './requestScope.ts'

export function identityWriter(
    scope: RequestScope,
    context: ReactiveScope,
): (next: Partial<Principal> | undefined) => void {
    return (next: Partial<Principal> | undefined): void => {
        if (next === undefined) {
            // Logout: a FRESH anonymous principal, not a mutation of the old one — anything the app
            // merged in must not survive the clear.
            const fresh = anonymousPrincipal()
            scope.identity = fresh
            context.identity = fresh
            scope.identityCleared = true
            return
        }
        // set() authenticates unless the caller opts out (AU3.3), and fails fast before persisting an
        // authenticated identity with no stable secret to seal it with (AU5.3).
        const authenticated = next.authenticated ?? true
        requireSecretForAuthedSet(authenticated)
        Object.assign(scope.identity, next, { authenticated })
        context.identity = scope.identity
        scope.identityCleared = false
        // A login must be persisted on THIS response — the one case the router's roll-only-when-due
        // check must not skip.
        scope.identityDirty = true
    }
}
