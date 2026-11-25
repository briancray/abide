/**
 * The JSON Schema a Standard JSON Schema `schema` declares for its input, or `undefined` where it
 * declares none or its converter throws.
 *
 * 20.11 — asked for draft 2020-12, the target the spec makes every caller name: a converter may
 * read it unguarded, and one that throws describes nothing rather than failing the caller.
 */
export function standardJsonSchemaOf(schema: unknown): object | undefined {
    const standard = (
        schema as
            | {
                  '~standard'?:
                      | {
                            jsonSchema?:
                                | {
                                      input?:
                                          | ((options: unknown) => unknown)
                                          | undefined
                                  }
                                | undefined
                        }
                      | undefined
              }
            | undefined
    )?.['~standard']
    let document: unknown
    try {
        document = standard?.jsonSchema?.input?.({ target: 'draft-2020-12' })
    } catch {
        return undefined
    }
    return document !== null && typeof document === 'object'
        ? document
        : undefined
}
