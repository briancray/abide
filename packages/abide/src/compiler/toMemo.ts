// 38.215 — THE MIGRATION OFF A BODY HANDED TO `reactive`: every `reactive(…)` whose first argument is
// a function is a `memo(…)` from the release this migration is keyed to on, since `reactive` holds a
// function rather than running it (4.20, 11.74).

import { isBody, renameBodyCalls } from './renameBodyCalls.ts'
import { rewriteCode } from './rewriteCode.ts'

/** 38.215 — `text`, a file at `path`, with each `reactive` handed a body renamed `memo`. */
export function toMemo(text: string, path: string): string {
    return rewriteCode(text, path, TO_MEMO)
}

const TO_MEMO = renameBodyCalls('reactive', 'memo', isBody)
