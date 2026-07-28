// The identity a unit of work has when nothing proved otherwise: a fresh, untracked id that is
// explicitly NOT authenticated. `identity()` never returns null — "nobody proved anything" is an
// answer, not an absence, so every caller can read `.authenticated` without a null check.

import type { Principal } from './principal.ts'

export function anonymousPrincipal(): Principal {
    return { id: crypto.randomUUID(), authenticated: false }
}
