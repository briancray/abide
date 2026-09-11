// LINES OF CODE, and it is homed here rather than in a lane for the reason
// `read-invoice`'s own note already gives: it is a number the bench table needs and
// no lane can produce. A `Bun.Glob` in the leaf would make the leaf bun-only and
// contradict the one property it is justified by.
//
// CODE LINES ONLY. Blank lines and comment-only lines are not what a reader is being
// asked to compare, and counting them makes the ratio a function of how a file was
// laid out.
// `#` IS A COMMENT MARKER ONLY WHEN IT STANDS ALONE. `#(?!!)` — "a hash that is not a
// shebang" — swallows a TypeScript private field: `#count = 0` and `#compute() {` are
// code, and dropping them charges the arm that uses them fewer lines than it wrote.
const COMMENT_ONLY =
    /^\s*(?:\/\/|\/\*|\*\/|\*(?!\/)|<!--|-->|#(?=\s|$))|^\s*\*\s*$/

export async function countLines(
    directory: URL,
    files: string[],
): Promise<number> {
    let lines = 0
    for (const name of files) {
        const text = await Bun.file(new URL(name, directory)).text()
        // A `/* */` BODY IS STILL A COMMENT even when its lines do not start with `*`.
        // The per-line test alone counts the prose inside one as code, which makes the
        // ratio a function of which comment style an arm was written in.
        let inBlock = false
        for (const line of text.split('\n')) {
            const trimmed = line.trim()
            if (trimmed === '') continue
            if (inBlock) {
                if (trimmed.includes('*/')) inBlock = false
                continue
            }
            if (COMMENT_ONLY.test(line)) {
                if (trimmed.startsWith('/*') && !trimmed.includes('*/'))
                    inBlock = true
                continue
            }
            lines += 1
        }
    }
    return lines
}
