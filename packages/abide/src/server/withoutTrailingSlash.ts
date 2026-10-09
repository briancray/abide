/** `text` with every `/` it ends in taken off — a URL or a mount path, written the way it joins. */
export function withoutTrailingSlash(text: string): string {
    return text.replace(/\/+$/, '')
}
