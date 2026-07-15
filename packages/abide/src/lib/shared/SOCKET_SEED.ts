import { SEEDS } from './SEEDS.ts'

/* The socket warm-seed manifest: a socket's retained latest frame as read via `peek(socket)` during
   SSR, keyed by the socket's name, as a ref-json-encoded STRING (decoded at the read site in
   `socketProxy`). `startClient` drains `__SSR__.sockets` into here before mount; a hydrating
   `socketProxy` reads its key to seed the socket's `lastFrame` WARM, so `peek(socket)` returns the
   SAME retained value the server rendered instead of `undefined` on the not-yet-connected client —
   killing the SSR/hydration divergence that would otherwise discard the server markup and cold-render.

   The `sockets` partition of the one `__abideSeeds` manifest (ADR-0048, see SEEDS). */
// @documentation plumbing
export const SOCKET_SEED: Record<string, string> = SEEDS.sockets
