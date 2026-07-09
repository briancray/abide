import type { StandardSchemaV1 } from '../../src/lib/shared/types/StandardSchemaV1.ts'

/*
A real (rejecting) Standard Schema defined in its OWN module so an ADR-0026 test can
import it into an rpc's `schemas.input` — proving the ADR-0022 D2 "live opts" reach:
an imported validator (not an inline literal) genuinely runs client-side in
`remoteProxy`'s pre-flight. Requires a non-empty string `name`; a miss yields one
issue at path `['name']`.
*/
export const importedNameSchema: StandardSchemaV1<{ name: string }, { name: string }> = {
    '~standard': {
        version: 1,
        vendor: 'abide-test',
        validate(value) {
            const name = (value as { name?: unknown } | undefined)?.name
            if (typeof name === 'string' && name.length > 0) {
                return { value: { name } }
            }
            return { issues: [{ message: 'Required', path: ['name'] }] }
        },
    },
}
