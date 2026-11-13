// 38.155, 38.156 — WHAT THE NATIVE WINDOW INSTALLS IN EVERY PAGE IT LOADS: a titlebar a press
// on `data-abide-titlebar` drags, and the page's background reported to the window behind it.
//
// SERIALIZED, not imported: `openNativeWindow` hands its source to a `WKUserScript`, so the
// function closes over nothing and every name it reads is the page's own.

/** Posts `drag`, `zoom` and `background <r> <g> <b>` to the window's `abideWindow` handler. */
export function windowBridge(): void {
    const handler = (
        globalThis as {
            webkit?: {
                messageHandlers?: {
                    abideWindow?: { postMessage(message: string): void }
                }
            }
        }
    ).webkit?.messageHandlers?.abideWindow
    if (handler === undefined) return

    addEventListener('mousedown', (pressed) => {
        const event = pressed as MouseEvent
        if (event.button !== 0 || !(event.target instanceof Element)) return
        const region = event.target.closest('[data-abide-titlebar]')
        if (region === null) return
        // A control inside the titlebar answers its press itself.
        const control = event.target.closest(
            'a, button, input, select, textarea, label, summary, [contenteditable], [tabindex]',
        )
        if (control !== null && region.contains(control)) return
        event.preventDefault()
        handler.postMessage(event.detail === 2 ? 'zoom' : 'drag')
    })

    // A one-pixel canvas resolves any CSS color — `oklch()` included — to the sRGB bytes AppKit takes.
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const context = canvas.getContext('2d', { willReadFrequently: true })
    const opaque = (element: Element | null): string | undefined => {
        if (element === null || context === null) return undefined
        context.clearRect(0, 0, 1, 1)
        context.fillStyle = getComputedStyle(element).backgroundColor
        context.fillRect(0, 0, 1, 1)
        const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data
        return alpha === 255 ? `${red} ${green} ${blue}` : undefined
    }
    const report = (): void => {
        const color = opaque(document.documentElement) ?? opaque(document.body)
        if (color !== undefined) handler.postMessage(`background ${color}`)
    }
    addEventListener('load', report)
    matchMedia('(prefers-color-scheme: dark)').addEventListener(
        'change',
        report,
    )
}
