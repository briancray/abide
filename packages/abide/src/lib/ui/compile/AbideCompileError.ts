/*
A compile-time `.abide` error carrying the absolute source offset of the
offending node (when the parser tracked one). The loader catches it, resolves the
offset to `line:col` against the file, and re-throws with the component path and
position in the message — so a failed build names the exact file and line, not the
entry page at offset 0 (Bun frames plugin throws at `<file>:0` regardless).
*/
export class AbideCompileError extends Error {
    readonly offset: number | undefined

    constructor(message: string, offset?: number) {
        super(message)
        this.name = 'AbideCompileError'
        this.offset = offset
    }
}
