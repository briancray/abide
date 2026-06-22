import { safeJsonForScript } from '../shared/safeJsonForScript.ts'
import type { ResumeEntry } from './runtime/RESUME.ts'

/* A self-contained `<script>` seeding the await-resume manifest with the blocking
   values rendered inline on the server, so client hydration adopts each resolved
   branch instead of re-running its promise. Empty when nothing blocking resolved.
   The payload runs as JS (`Object.assign`), so it's encoded via `safeJsonForScript`
   — escaping `<`, `-->`, and U+2028/U+2029 so a serialized body value can't close
   the script early or parse as a line terminator. Shared by the buffered
   (`createUiPageRenderer`) and streaming (`renderToStream`) paths. */
// @documentation plumbing
export function resumeSeedScript(resume: Record<number, ResumeEntry>): string {
    if (Object.keys(resume).length === 0) {
        return ''
    }
    return `<script>Object.assign(window.__abideResume=window.__abideResume||{},${safeJsonForScript(resume)})</script>`
}
