import { encodeSeedValue } from '../shared/encodeSeedValue.ts'
import type { ResumeEntry } from './runtime/RESUME.ts'

/* ref-json-encode an await-resume entry, or `undefined` if it can't be serialized — the
   await-resume arm of the shared serialize-or-degrade policy (`encodeSeedValue`): drop
   just this entry, so the client re-runs that one branch's promise while every other
   branch stays seeded. Shared by the streaming (`renderToStream`) and buffered/seed
   (`resumeSeedScript`) paths. */
export function tryEncodeResume(entry: ResumeEntry, id: number | string): string | undefined {
    return encodeSeedValue(entry, `resume for await ${id}`, 'the client will refetch it')
}
