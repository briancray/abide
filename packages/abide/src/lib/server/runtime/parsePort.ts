import { parseBoundedEnvInt } from '../../shared/parseBoundedEnvInt.ts'

/*
Parses a PORT env value into a usable TCP port (0–65535), returning undefined
for missing, empty, or out-of-range/non-integer input so the caller can fall
back to a default. A bare Number() would turn '' into 0 (a random
kernel-assigned port) and 'abc' into NaN, both silently wrong.
*/
export function parsePort(value: string | undefined): number | undefined {
    return parseBoundedEnvInt(value, 0, 65535)
}
