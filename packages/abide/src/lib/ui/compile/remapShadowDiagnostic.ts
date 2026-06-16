import type { ShadowMapping } from './types/CompiledShadow.ts'

/*
Relocates a diagnostic's shadow span back to the original `.abide` source. The
diagnostic must *overlap* a mapped segment (a verbatim-emitted expression);
diagnostics confined to synthesised scaffolding overlap nothing and are dropped —
that is the filter that keeps shadow-internal noise out of the editor. Overlap
(not containment) is required because TypeScript often reports a whole-expression
mismatch at the synthetic wrapping `(`, one char before the mapped span; the
result is clamped into the segment so it lands on real source either way.
*/
export function remapShadowDiagnostic(
    mappings: ShadowMapping[],
    shadowStart: number,
    shadowLength: number,
): { start: number; length: number } | undefined {
    const shadowEnd = shadowStart + Math.max(shadowLength, 1)
    const mapping = mappings.find(
        (entry) => shadowStart < entry.shadowStart + entry.length && entry.shadowStart < shadowEnd,
    )
    if (mapping === undefined) {
        return undefined
    }
    const clampedStart = Math.max(shadowStart, mapping.shadowStart)
    const segmentEnd = mapping.shadowStart + mapping.length
    return {
        start: mapping.sourceStart + (clampedStart - mapping.shadowStart),
        length: Math.max(1, Math.min(shadowEnd, segmentEnd) - clampedStart),
    }
}
