import { relative } from 'node:path' // bun exposes no path helpers of its own
import type { Diagnosis } from './TypeSession.ts'

// ONE LINE A FINDING, in the shape `tsc` and every editor's problem matcher already read:
// `file:line:column - error TS2322: …`, the path relative to where the command was run. A finding
// with no line — a whole-file or whole-app refusal — names the file alone.
export function formatDiagnosis(diagnosis: Diagnosis, from: string): string {
    const path = relative(from, diagnosis.path) || diagnosis.path
    const where =
        diagnosis.line === 0
            ? path
            : `${path}:${diagnosis.line}:${diagnosis.column}`
    const code = diagnosis.code === 0 ? '' : ` TS${diagnosis.code}`
    return `${where} - ${diagnosis.category}${code}: ${diagnosis.message}`
}
