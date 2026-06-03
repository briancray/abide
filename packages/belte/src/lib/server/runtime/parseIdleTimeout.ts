/*
Parses BELTE_IDLE_TIMEOUT into Bun's per-connection idle timeout in seconds.
Bun accepts 0–255 (0 disables the timeout); returns undefined for missing,
empty, or out-of-range/non-integer input so the caller keeps its default. A
bare Number() turns '' into 0 (silently disabling the timeout) and 'abc' into
NaN, both wrong; this rejects them instead.
*/
export function parseIdleTimeout(value: string | undefined): number | undefined {
    if (value === undefined || value.trim() === '') {
        return undefined
    }
    const seconds = Number(value)
    if (!Number.isInteger(seconds) || seconds < 0 || seconds > 255) {
        return undefined
    }
    return seconds
}
