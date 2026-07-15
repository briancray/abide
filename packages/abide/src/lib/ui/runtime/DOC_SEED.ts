import { SEEDS } from '../../shared/SEEDS.ts'

/* The doc-state warm-seed manifest: an SSR-captured reactive-document snapshot, keyed by its
   scope's serialization-stable render-path id, as a ref-json-encoded STRING (decoded at the read
   site in `createScope`). `startClient` drains `__SSR__.docs` into here before mount; a hydrating
   scope reads its key to seed a plain `state(initial)` to the SERVER value instead of the fresh
   init — a uuid/timestamp/random otherwise diverges from the SSR HTML.

   The `docs` partition of the one `__abideSeeds` manifest (ADR-0048, see SEEDS). */
export const DOC_SEED: Record<string, string> = SEEDS.docs
