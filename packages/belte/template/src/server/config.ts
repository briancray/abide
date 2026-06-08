/*
Typed environment. `env(schema)` validates Bun.env against a Standard Schema at
boot — a missing or malformed variable fails the boot with every issue listed,
instead of surfacing as `undefined` inside a handler. Import `config` from
`$server/config` anywhere server-side; it's typed from the schema.

Belte eager-imports this file at boot (the belte:config virtual) — no import is
needed from your own code. The floor below re-exports Bun.env untyped; swap it
for a schema once you have required variables:

  import { env } from '@belte/belte/server/env'
  import { z } from 'zod'
  export const config = env(z.object({ DATABASE_URL: z.string() }))

Optional — delete this file to read Bun.env directly instead.
*/
export const config = Bun.env
