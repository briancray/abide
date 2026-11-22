// 51.16, 51.73, 51.113, 51.114 — WHERE WHAT WAS TYPED IS IN A LABEL: the one matcher `combobox` and
// `commandPalette` narrow their lists by and mark their labels with, so what is listed and what is
// marked cannot disagree. A needle is a literal found ignoring case, by `RegExp` so a match's place is
// its place in the label as written — lowering the label first can change its length.

/** A run of a label: its text, and the `match` part to spread on the element marking it where the run is what was typed. */
export type LabelRun = {
    readonly text: string
    readonly match: Record<string, unknown> | undefined
}

const MATCH = { 'data-part': 'match' }

/** What `text` is looked for by: itself whole, or each word of it where `words` is set; none where it is blank. */
export function needlesOf(text: string, words: boolean): readonly RegExp[] {
    const needles: RegExp[] = []
    for (const word of words ? text.split(/\s+/) : [text])
        if (word !== '') needles.push(new RegExp(RegExp.escape(word), 'iu'))
    return needles
}

/** `label` cut into runs, the first place each needle is in it marked, runs that overlap or touch marked as one. */
export function labelRuns(
    label: string,
    needles: readonly RegExp[],
): readonly LabelRun[] {
    // Each found place as a start and an end, kept in order of start as they are found.
    const spans: number[] = []
    for (const needle of needles) {
        const found = needle.exec(label)
        if (found === null) continue
        const start = found.index
        let at = spans.length
        while (at > 0 && (spans[at - 2] as number) > start) at -= 2
        spans.splice(at, 0, start, start + found[0].length)
    }
    const runs: LabelRun[] = []
    let from = 0
    for (let index = 0; index < spans.length; index += 2) {
        const start = Math.max(spans[index] as number, from)
        let end = spans[index + 1] as number
        while (
            index + 2 < spans.length &&
            (spans[index + 2] as number) <= end
        ) {
            end = Math.max(end, spans[index + 3] as number)
            index += 2
        }
        if (end <= start) continue
        if (start > from)
            runs.push({ text: label.slice(from, start), match: undefined })
        runs.push({ text: label.slice(start, end), match: MATCH })
        from = end
    }
    if (from < label.length || runs.length === 0)
        runs.push({ text: label.slice(from), match: undefined })
    return runs
}
