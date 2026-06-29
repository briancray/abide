/* The `abide-` tag prefix on framework-owned custom elements (the router's
   `abide-outlet`, the streaming `abide-resolve`/`abide-cache` fragments). `scopeLabel`
   strips it to derive the bare name from a framework-owned host tag (e.g. `abide-resolve` → `resolve`). Child components no longer mount into
   an `abide-<name>` wrapper — they build as marker ranges (see `mountRange`). */
export const COMPONENT_WRAPPER_PREFIX = 'abide-'
