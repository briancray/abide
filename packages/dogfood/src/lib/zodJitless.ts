import { config } from 'zod'

// zod probes for `new Function` when it BUILDS an object schema, and the CSP refuses that eval
// (29.5). `Doc` imports this module and every page imports `Doc` ahead of its examples, so this runs
// before any example's schema module does — which is what keeps the switch out of the example source.
config({ jitless: true })
