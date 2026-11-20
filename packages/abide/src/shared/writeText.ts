/**
 * 53.22 — whether `text` reached the clipboard. `navigator.clipboard` exists in a secure context
 * alone, so a page served over plain http copies through a selected textarea instead.
 */
export async function writeText(text: string): Promise<boolean> {
    if (navigator.clipboard !== undefined)
        try {
            await navigator.clipboard.writeText(text)
            return true
        } catch {
            // Refused: no focus, or no permission. The textarea may still copy.
        }
    const focused = document.activeElement
    const field = document.createElement('textarea')
    field.value = text
    field.setAttribute('readonly', '')
    field.style.position = 'fixed'
    field.style.opacity = '0'
    document.body.append(field)
    field.select()
    let copied = false
    try {
        copied = document.execCommand('copy')
    } catch {
        copied = false
    }
    field.remove()
    if (focused instanceof HTMLElement) focused.focus()
    return copied
}
