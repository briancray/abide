/** Whether a value is a plain keyed object: not `null`, and not an array. */
export function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}
