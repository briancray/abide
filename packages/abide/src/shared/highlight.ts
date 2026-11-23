// 52.110, 52.111 — WHERE A SEARCH IS IN A TEXT, as runs an app renders, each run holding what was
// searched for carrying the `match` part: the matcher `combobox` and `commandPalette` mark their
// labels with (`labelRuns`), handed to an app for a text of its own.

import { type LabelRun, labelRuns, needlesOf } from './labelRuns.ts'

// 49.3 — the part a matched run spreads.
const MATCH = { 'data-highlight': 'match' }

/** `text` cut into runs, the first stretch holding `query` — or each word of it, given `words` — carrying the `match` part. */
export function highlight(
    text: string,
    query: string,
    options: { words?: boolean } = {},
): readonly LabelRun[] {
    return labelRuns(text, needlesOf(query, options.words === true), MATCH)
}
