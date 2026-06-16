// String results print verbatim (with a trailing newline); everything else as a JSON line.
export function printValue(value: unknown, pretty: boolean): void {
    if (typeof value === 'string') {
        process.stdout.write(value.endsWith('\n') ? value : `${value}\n`)
        return
    }
    if (value !== undefined) {
        process.stdout.write(`${JSON.stringify(value, null, pretty ? 2 : undefined)}\n`)
    }
}
