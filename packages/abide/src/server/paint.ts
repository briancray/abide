/** `text` in the ANSI style `code` names when `color` allows it — `useColor()` decides that. */
export function paint(color: boolean, code: string, text: string): string {
    return color ? `\x1b[${code}m${text}\x1b[0m` : text
}
