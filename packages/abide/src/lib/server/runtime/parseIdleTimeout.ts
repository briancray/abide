import { parseBoundedEnvInt } from '../../shared/parseBoundedEnvInt.ts'

/*
Parses ABIDE_IDLE_TIMEOUT into Bun's per-connection idle timeout in seconds.
Bun accepts 0–255 (0 disables the timeout); returns undefined for missing,
empty, or out-of-range/non-integer input so the caller keeps its default.
*/
export function parseIdleTimeout(value: string | undefined): number | undefined {
    return parseBoundedEnvInt(value, 0, 255)
}
