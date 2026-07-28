import { readEnv } from '../../shared/internal/readEnv.ts'

// The single production gate — drives the `Secure` cookie flag, HSTS, the authenticated
// `identity.set()` secret fail-fast (AU5.3), and the dev-only request-scope assertions.
// Case/whitespace-insensitive ON PURPOSE: a `Production` / `PRODUCTION ` misconfiguration must still
// enable the prod security posture (fail-SAFE) rather than silently degrade it. An unset NODE_ENV is
// development, per the Node convention. A set-but-unrecognized value (`prod`, `staging`) is treated as
// non-production and warned once at boot — see `createApp`.
//
// Its own file rather than `auth.ts`'s because `requestScope` needs it too and `auth` already imports
// `requestScope` — a raw `NODE_ENV !== 'production'` at those call sites was the workaround, and it
// silently disarmed the dev guards on a `NODE_ENV=Production` deploy.
export function isProd(): boolean {
    return (readEnv('NODE_ENV') ?? '').trim().toLowerCase() === 'production'
}
