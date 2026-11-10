/**
 * The lines `console.warn` was told while `body` ran that include `including` — every line by
 * default — with `console.warn` restored however the body ends. A body returning a promise is
 * awaited, and so is the answer; a synchronous body answers synchronously, so nothing queued behind
 * it runs before the restore.
 */
export function warningsWhile(
    body: () => Promise<unknown>,
    including?: string,
): Promise<string[]>
export function warningsWhile(body: () => unknown, including?: string): string[]
export function warningsWhile(
    body: () => unknown,
    including = '',
): string[] | Promise<string[]> {
    const said: string[] = []
    const warn = console.warn
    console.warn = (...parts: unknown[]): void => {
        const line = parts.map(String).join(' ')
        if (line.includes(including)) said.push(line)
    }
    let ran: unknown
    try {
        ran = body()
    } catch (thrown) {
        console.warn = warn
        throw thrown
    }
    if (!(ran instanceof Promise)) {
        console.warn = warn
        return said
    }
    return ran
        .then(() => said)
        .finally(() => {
            console.warn = warn
        })
}
