/** One line of the diff: kept (" "), removed ("-") or added ("+"), with where it is in each file. */
type Step = { mark: string; text: string; old: number; new: number }

/** Lines of context a hunk keeps around what changed, as `diff -u` keeps them. */
const CONTEXT = 3

/**
 * 38.201 — `before` against `after` as a unified diff of the file at `path`, the shape `git apply` and
 * every reviewer already reads; empty where the two are the same.
 *
 * A LONGEST COMMON SUBSEQUENCE OVER LINES, quadratic: what is diffed is an app's notes and sources,
 * hundreds of lines, never a build.
 */
export function unifiedDiff(
    path: string,
    before: string,
    after: string,
): string {
    if (before === after) return ''
    const from = before.split('\n')
    const to = after.split('\n')
    const width = to.length + 1
    // common[i * width + j]: the longest common subsequence of from[i..] and to[j..]
    const common = new Uint32Array((from.length + 1) * width)
    for (let i = from.length - 1; i >= 0; i--)
        for (let j = to.length - 1; j >= 0; j--)
            common[i * width + j] =
                from[i] === to[j]
                    ? (common[(i + 1) * width + j + 1] as number) + 1
                    : Math.max(
                          common[(i + 1) * width + j] as number,
                          common[i * width + j + 1] as number,
                      )
    const script: Step[] = []
    let i = 0
    let j = 0
    while (i < from.length || j < to.length) {
        if (i < from.length && j < to.length && from[i] === to[j]) {
            script.push({
                mark: ' ',
                text: from[i] as string,
                old: i++,
                new: j++,
            })
        } else if (
            j >= to.length ||
            (i < from.length &&
                (common[(i + 1) * width + j] as number) >=
                    (common[i * width + j + 1] as number))
        ) {
            script.push({
                mark: '-',
                text: from[i] as string,
                old: i++,
                new: j,
            })
        } else {
            script.push({ mark: '+', text: to[j] as string, old: i, new: j++ })
        }
    }
    let text = `--- a/${path}\n+++ b/${path}\n`
    let index = 0
    while (index < script.length) {
        if ((script[index] as Step).mark === ' ') {
            index++
            continue
        }
        // a hunk: from CONTEXT lines before this change to CONTEXT lines past the last change
        // closer than two contexts to the one before it
        const start = Math.max(0, index - CONTEXT)
        let end = index
        for (let next = index; next < script.length; next++)
            if ((script[next] as Step).mark !== ' ') {
                if (next - end > CONTEXT * 2) break
                end = next
            }
        const stop = Math.min(script.length, end + CONTEXT + 1)
        let removed = 0
        let added = 0
        let body = ''
        for (let line = start; line < stop; line++) {
            const step = script[line] as Step
            if (step.mark !== '+') removed++
            if (step.mark !== '-') added++
            body += `${step.mark}${step.text}\n`
        }
        const first = script[start] as Step
        text += `@@ -${first.old + 1},${removed} +${first.new + 1},${added} @@\n${body}`
        index = stop
    }
    return text
}
