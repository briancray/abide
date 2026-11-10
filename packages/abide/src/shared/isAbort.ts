/** Whether `error` is an abort, which was asked for — a superseded call's, a stopped stream's. 37.28. */
export function isAbort(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError'
}
