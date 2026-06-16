/*
Parses an env string into an integer within [min, max], returning undefined for
missing, empty, or out-of-range/non-integer input so the caller can fall back to
a default. A bare Number() turns '' into 0 and 'abc' into NaN, both silently
wrong; this rejects them instead.
*/
export function parseBoundedEnvInt(
    value: string | undefined,
    min: number,
    max: number,
): number | undefined {
    if (value === undefined || value.trim() === '') {
        return undefined
    }
    const parsed = Number(value)
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
        return undefined
    }
    return parsed
}
