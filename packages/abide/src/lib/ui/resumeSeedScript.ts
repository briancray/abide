import { safeJsonForScript } from '../shared/safeJsonForScript.ts'
import type { ResumeEntry } from './runtime/RESUME.ts'
import { tryEncodeResume } from './tryEncodeResume.ts'

/* A self-contained `<script>` seeding the await-resume manifest with the blocking
   values rendered inline on the server, so client hydration adopts each resolved
   branch instead of re-running its promise. Empty when nothing blocking resolved.
   Each entry is ref-json-encoded to a string (decoded at read in `awaitBlock`); the
   id→string map runs as JS (`Object.assign`), so it's wrapped in `safeJsonForScript`
   — escaping `<`, `-->`, and U+2028/U+2029 so an encoded value can't close the script
   early or parse as a line terminator. Shared by the buffered (`createUiPageRenderer`)
   and streaming (`renderToStream`) paths. */
// @documentation plumbing
export function resumeSeedScript(resume: Record<string, ResumeEntry>): string {
    /* ref-json (not JSON) so a value carrying cycles or shared back-references — a
       media tree with parent↔child links — seeds instead of being dropped. `tryEncodeResume`
       drops just an unserializable entry (the client re-runs that one branch's promise),
       keeping every other branch seeded rather than blanking the whole page. */
    const encoded = Object.entries(resume).flatMap(([id, entry]) => {
        const text = tryEncodeResume(entry, id)
        return text === undefined ? [] : [[id, text] as const]
    })
    if (encoded.length === 0) {
        return ''
    }
    return `<script>Object.assign((window.__abideSeeds=window.__abideSeeds||{}).resume=window.__abideSeeds.resume||{},${safeJsonForScript(Object.fromEntries(encoded))})</script>`
}
