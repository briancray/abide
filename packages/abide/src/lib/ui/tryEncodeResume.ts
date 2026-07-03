import { encodeRefJson } from '../shared/encodeRefJson.ts'
import type { DeferMarker, ResumeEntry } from './runtime/RESUME.ts'

/* ref-json-encode an await-resume entry, or `undefined` if it can't be serialized.
   encodeRefJson is total (cycles become back-references, functions fold to undefined),
   but a pathological throw must not blank the surrounding seed/stream — drop just this
   entry and warn, so the client re-runs that one branch's promise while every other
   branch stays seeded. Shared by the streaming (`renderToStream`) and buffered/seed
   (`resumeSeedScript`) paths so the serialize-or-refetch policy lives in one place. */
export function tryEncodeResume(
    entry: ResumeEntry | DeferMarker,
    id: number | string,
): string | undefined {
    try {
        return encodeRefJson(entry)
    } catch (cause) {
        console.warn(
            `[abide] resume for await ${id} is not serializable; client will refetch it`,
            cause,
        )
        return undefined
    }
}
