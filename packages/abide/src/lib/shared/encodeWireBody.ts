/*
The single honest-JSON ENCODE point for the REST response faces (`json()` and the
per-frame `sse()` body). JSON.stringify driven by wireJsonReplacer so a structured
runtime value crosses as honest JSON — a `Set` → array, a `Map` → `[K,V]` entries, a
`bigint` → digit string — instead of the silent `{}` a bare Set stringifies to or the
throw a bare bigint triggers. Value-directed (not type-directed), so every consumer
reads the same honest JSON the projected schema (jsonSchemaForType) describes: abide's
own client and a foreign EventSource/curl alike.

This is the REST counterpart to the ws path's encodeRefJson: it preserves the
structured values losslessly the way ref-json does, but without the `[rootValue, slots]`
envelope a foreign REST consumer (a naive EventSource + JSON.parse) can't read.
*/
import { wireJsonReplacer } from './wireJsonReplacer.ts'

export function encodeWireBody(value: unknown): string {
    return JSON.stringify(value, wireJsonReplacer)
}
