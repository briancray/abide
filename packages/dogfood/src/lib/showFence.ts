// AN ANSWER'S `show` BLOCK: a fence whose info names one live thing to render in its place —
// ```show name="watch"``` — read by `ShowBlock` as it closes (40.28), and by `Ask` for the page an
// `open` moves under the conversation.

/** One kind of rendering and what it renders. `from` narrows a `code` to the construct a line prefix opens (40.15). */
export type Show =
    | { kind: 'code'; value: string; from: string | undefined }
    | { kind: 'name'; value: string }
    | { kind: 'clause'; value: string }
    | { kind: 'results'; value: string }
    | { kind: 'page'; value: string }
    | { kind: 'open'; value: string }

const SHOW =
    /^\s*(code|name|clause|results|page|open)="([^"]*)"(?:\s+from="([^"]*)")?\s*$/

/** The `Show` a `show` fence's info names, or `undefined` where it names none. */
export function showOf(info: string): Show | undefined {
    const match = SHOW.exec(info)
    if (match === null) return undefined
    const kind = match[1] as Show['kind']
    const value = match[2] ?? ''
    return kind === 'code'
        ? { kind, value, from: match[3] }
        : ({ kind, value } as Show)
}

// A `show open` fence the model has closed: its opening line, then its closing line.
const OPENED = /^ {0,3}(`{3,}|~{3,})show\s+open="([^"]*)"\s*\n {0,3}\1\s*$/gm

/** The routes of every closed `show open` block in `text`, in order. */
export function openedIn(text: string): string[] {
    const routes: string[] = []
    for (const match of text.matchAll(OPENED)) routes.push(match[2] ?? '')
    return routes
}
