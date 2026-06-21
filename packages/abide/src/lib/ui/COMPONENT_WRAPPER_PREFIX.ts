/* The `abide-` tag prefix on framework-owned custom elements (the router's
   `abide-outlet`, the streaming `abide-resolve`/`abide-cache` fragments). `scopeLabel`
   strips it to read the outlet host's bare name. Child components no longer mount into
   an `abide-<name>` wrapper — they build as marker ranges (see `mountRange`). */
export const COMPONENT_WRAPPER_PREFIX = 'abide-'
