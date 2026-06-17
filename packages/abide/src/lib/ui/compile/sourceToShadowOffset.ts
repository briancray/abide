import type { ShadowMapping } from './types/CompiledShadow.ts'

/*
Translates an offset in the original `.abide` source to the equivalent offset in
its type-checking shadow — the inverse of `remapShadowDiagnostic`. Drives
position-based language-service queries (hover, completion, …) from an editor
position: find the verbatim-emitted segment whose source span covers the offset
and shift it into shadow coordinates. An offset outside every mapped span
(whitespace, markup, framework syntax the shadow doesn't emit verbatim) has no
shadow position, so the query is skipped.
*/
export function sourceToShadowOffset(
    mappings: ShadowMapping[],
    sourceOffset: number,
): number | undefined {
    const mapping = mappings.find(
        (entry) =>
            entry.sourceStart <= sourceOffset && sourceOffset < entry.sourceStart + entry.length,
    )
    if (mapping === undefined) {
        return undefined
    }
    return mapping.shadowStart + (sourceOffset - mapping.sourceStart)
}
