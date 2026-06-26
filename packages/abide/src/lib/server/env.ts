import type { StandardSchemaV1 } from '../shared/types/StandardSchemaV1.ts'
import { envSchemaStore } from './runtime/envSchemaStore.ts'

/*
Validates the process environment against a Standard Schema and returns the
typed, parsed config. Built to be called at module top level so a missing or
malformed variable fails the boot loudly rather than surfacing as `undefined`
deep inside a handler:

  // src/server/config.ts
  export const config = env(
      v.object({ DATABASE_URL: v.string(), STRIPE_KEY: v.string() }),
  )

Reads `Bun.env` (the process environment plus any `.env` Bun loaded), so any
Standard Schema library — zod, valibot, arktype — works without an adapter,
same as the rpc helpers. Coercion (e.g. a numeric PORT) lives in the schema.

The schema is registered (envSchemaStore) so the bundle launcher can project
the first-run setup form from the same declaration. When the launcher imports
this purely to read that schema it sets `skipValidation`, so env() registers
and returns without validating Bun.env — boot validation stays the server's.

Validation must be synchronous — boot can't await config — so a schema whose
`validate` returns a Promise throws. On failure every issue is reported at once
(path + message) so a misconfigured deploy shows the full list rather than one
variable per restart.
*/
// @documentation configuration
export function env<Schema extends StandardSchemaV1>(
    schema: Schema,
): StandardSchemaV1.InferOutput<Schema> {
    envSchemaStore.schema = schema
    if (envSchemaStore.skipValidation) {
        return Bun.env as unknown as StandardSchemaV1.InferOutput<Schema>
    }
    const result = schema['~standard'].validate(Bun.env)
    if (result instanceof Promise) {
        throw new Error('[abide] env() schema must validate synchronously')
    }
    if (result.issues) {
        const lines = result.issues.map((issue) => {
            const path = issue.path
                ?.map((segment) => String(typeof segment === 'object' ? segment.key : segment))
                .join('.')
            return path ? `  ${path}: ${issue.message}` : `  ${issue.message}`
        })
        throw new Error(`[abide] invalid environment:\n${lines.join('\n')}`)
    }
    return result.value
}
