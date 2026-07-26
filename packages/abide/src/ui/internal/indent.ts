// Shift a block of emitted code by `spaces`, leaving blank lines blank. Shared by the client and
// server emitters — both nest a generated block (the `<script>` setup preamble, a mount fn) inside a
// wrapper and need the result to stay readable in a stack trace.

export function indent(code: string, spaces: number): string {
    const pad = ' '.repeat(spaces)
    return code
        .split('\n')
        .map((line) => (line === '' ? line : pad + line))
        .join('\n')
}
