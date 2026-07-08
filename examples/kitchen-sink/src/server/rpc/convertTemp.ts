import { GET } from '@abide/abide/server/GET'
import { json } from '@abide/abide/server/json'
import { withJsonSchema } from '@abide/abide/shared/withJsonSchema'

/*
A hand-rolled Standard Schema — no schema library, just the `~standard` contract:
validate() checks the input and returns { value } or { issues }. Unlike zod 4 it
carries no native toJSONSchema(), so withJsonSchema attaches one. Without that
projection the rpc would still validate, but it would vanish from /openapi.json,
the /mcp tool list, and the CLI flag help — every surface that reads the schema as
JSON Schema. This is the wrap path zod never triggers.
*/
type Celsius = { celsius: number }

const celsiusSchema = {
    '~standard': {
        version: 1 as const,
        vendor: 'kitchen-sink',
        validate: (value: unknown) => {
            // validate is also the coercion point — query args arrive as strings, so
            // a number schema (zod's z.coerce.number, this by hand) parses them here.
            const raw = (value as { celsius?: unknown }).celsius
            const celsius = typeof raw === 'string' ? Number(raw) : raw
            return typeof celsius === 'number' && Number.isFinite(celsius)
                ? { value: { celsius } }
                : { issues: [{ message: 'celsius must be a finite number', path: ['celsius'] }] }
        },
        // Phantom carrier the rpc reads to type the handler's args (the spec's
        // InferInput/InferOutput live here); never present at runtime.
        types: undefined as unknown as { readonly input: Celsius; readonly output: Celsius },
    },
}

/* Args infer from inputSchema's ~standard types, so no explicit GET generics —
   that overload is what allows inputSchema in the options. */
const inputSchema = withJsonSchema(celsiusSchema, () => ({
    type: 'object',
    properties: { celsius: { type: 'number', description: 'temperature in degrees Celsius' } },
    required: ['celsius'],
}))

export const convertTemp = GET(({ celsius }) => json({ celsius, fahrenheit: celsius * 1.8 + 32 }), {
    schemas: { input: inputSchema },
})
