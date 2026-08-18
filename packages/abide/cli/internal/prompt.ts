// A terminal around the line editor — the loop, the raw mode, and the two lanes a prompt has.
//
// `editor.ts` deliberately knows nothing about a terminal: it takes its hooks, so a test drives the
// whole thing with a string of keystrokes. This is the other half, and it is here rather than in
// either prompt because there are two of them now — `abide repl` and `abide console` — and every line
// of the loop is the same three facts.
//
// **Reading is OUR loop.** Nothing is read while a line is being evaluated, so a keystroke typed
// during a slow one waits in the terminal's own buffer rather than in ours. That is what makes a
// prompt whose lines are `await`ed behave like one whose lines are not.
//
// **A pipe is not a terminal.** No banner, no raw mode, no editor — the same evaluation and the same
// printing, so what a script gets out of a prompt is what a person would have seen. Which of the two
// runs is `process.stdin.isTTY` and nothing else, because that is the question being asked: is there
// somebody there.

import { STREAMING } from '#shared/internal/STREAMING.ts'
import { LineEditor } from './editor.ts'

/** What a prompt is: what it paints, what it completes, and what a finished line means. */
export interface Prompting {
    /** What is painted before the line being typed. */
    prompt: string
    /** Painted once, before the first prompt. */
    banner?: string
    /** The remainder of the word being typed — asked per KEYSTROKE, so the caller keeps it cheap. */
    complete(prefix: string): string
    /** A finished line. Awaited, so nothing is read while it runs. */
    take(line: string): void | Promise<void>
    /** Ctrl-C. The editor has already dropped the line; this is what the CALLER has to let go of. */
    onInterrupt?(): void
    /**
     * Whether a line that has RUN ended the session — the console's `exit`, asked beside Ctrl-D.
     *
     * A hook rather than a return off `take`, because leaving is a fact about the caller's state
     * that outlives the line: the pipe lane reads the same flag to stop feeding, and a prompt that
     * could only be left with a keystroke would make `exit` a row in the table that does nothing.
     */
    done?(): boolean
    /**
     * The prompt for the NEXT line, when it is not the same one — the REPL's continuation form.
     *
     * Asked after a line has RUN rather than set by the caller, because that is when the answer can
     * have changed: a line that turned out to be unfinished is what makes the prompt a continuation,
     * and a console that names its target in the prompt has just moved it with `connect`.
     */
    after?(): string
}

/** Drive `asked` against this process's terminal until Ctrl-D. */
export async function prompted(asked: Prompting, colors: boolean): Promise<void> {
    if (asked.banner !== undefined) process.stdout.write(asked.banner)

    let leaving = false
    const lines: string[] = []
    const editor = new LineEditor(
        {
            write: (text) => void process.stdout.write(text),
            complete: (prefix) => asked.complete(prefix),
            onLine: (line) => void lines.push(line),
            onInterrupt: () => asked.onInterrupt?.(),
            onEnd: () => {
                leaving = true
            },
        },
        colors,
    )
    editor.prompt = asked.prompt
    editor.refresh()

    process.stdin.setRawMode(true)
    const decoder = new TextDecoder()
    try {
        for await (const chunk of process.stdin) {
            editor.feed(decoder.decode(chunk as Uint8Array, STREAMING))
            const ran = lines.length > 0
            while (lines.length > 0) await asked.take(lines.shift() as string)
            if (leaving || asked.done?.() === true) break
            // Only after a line: `feed` already repainted for the keystroke, and what a run leaves
            // behind is printed output the prompt has to be put back under.
            if (!ran) continue
            if (asked.after !== undefined) editor.prompt = asked.after()
            editor.refresh()
        }
    } finally {
        process.stdin.setRawMode(false)
        process.stdout.write('\n')
    }
}

/** The same lines from a pipe, a heredoc or a file. */
export async function piped(take: (line: string) => void | Promise<void>): Promise<void> {
    const text = await Bun.stdin.text()
    for (const line of text.split('\n')) await take(line)
}
