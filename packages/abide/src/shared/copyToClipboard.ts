// 53.22, 53.54, 53.55, 53.102, 53.103 — WHAT REACHES THE CLIPBOARD, and whether it did: the write
// `copy` makes on a click, for an app to make from a handler of its own.

import { isServer } from './isServer.ts'

/** What reaches the clipboard: text, or a record of MIME type to what that type holds — `ClipboardItem`'s own input. */
export type Copyable = string | Record<string, string | Blob>

/**
 * Writes `value` to the clipboard — a string as `text/plain`, a record as one item holding each type
 * it names — and settles whether it landed.
 *
 * 53.22 — `navigator.clipboard` exists in a secure context alone, and refuses a type the browser
 * does not write, so the fallback copies through a selected textarea and lays every string type
 * on the `copy` event the command fires. A Blob has no such path.
 *
 * @param value text, or a record of MIME type to what it holds
 */
export async function copyToClipboard(value: Copyable): Promise<boolean> {
    if (isServer())
        throw new Error(
            "copyToClipboard writes a visitor's clipboard, and a server has none: call it from a handler a browser runs. RULEBOOK 53.103.",
        )
    const types = typeof value === 'string' ? { 'text/plain': value } : value
    if (
        navigator.clipboard !== undefined &&
        typeof ClipboardItem === 'function'
    )
        try {
            const blobs: Record<string, Blob> = {}
            for (const type in types) {
                const data = types[type] as string | Blob
                // A string is a Blob already where the item is read, and Safari takes only a Blob.
                blobs[type] =
                    typeof data === 'string' ? new Blob([data], { type }) : data
            }
            await navigator.clipboard.write([new ClipboardItem(blobs)])
            return true
        } catch {
            // Refused: no focus, no permission, or a type the browser does not write.
        }
    const strings: [string, string][] = []
    // A copy event's data a browser ignores still leaves the selection, so it holds the plain text.
    let selected: string | undefined
    for (const type in types) {
        const data = types[type]
        if (typeof data !== 'string') continue
        strings.push([type, data])
        if (selected === undefined || type === 'text/plain') selected = data
    }
    // 53.55.
    if (selected === undefined) return false
    const carry = (event: ClipboardEvent): void => {
        if (event.clipboardData === null) return
        for (const [type, data] of strings)
            event.clipboardData.setData(type, data)
        event.preventDefault()
    }
    const focused = document.activeElement
    const field = document.createElement('textarea')
    field.value = selected
    field.setAttribute('readonly', '')
    field.style.position = 'fixed'
    field.style.opacity = '0'
    document.body.append(field)
    field.select()
    document.addEventListener('copy', carry)
    let copied = false
    try {
        copied = document.execCommand('copy')
    } catch {
        copied = false
    }
    document.removeEventListener('copy', carry)
    field.remove()
    if (focused instanceof HTMLElement) focused.focus()
    return copied
}
