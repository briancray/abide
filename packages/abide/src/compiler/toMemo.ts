// 38.215 — THE MIGRATION OFF A BODY HANDED TO `reactive`: every `reactive(…)` whose first argument is
// a function is a `memo(…)` from the release this migration is keyed to on, since that release had
// `reactive` hold a function rather than run it (11.73) — what 38.232 reverses.

import { isBody, renameBodyCalls } from './renameBodyCalls.ts'
import { rewriteCode } from './rewriteCode.ts'

/** 38.215 — `text`, a file at `path`, with each `reactive` handed a body renamed `memo`. */
export function toMemo(text: string, path: string): string {
    return rewriteCode(text, path, TO_MEMO)
}

const TO_MEMO = renameBodyCalls('reactive', 'memo', isBody)
