// 53.17-53.20 — FILES DROPPED ON AN ELEMENT, or pasted into it, filtered as a file input filters.

import type { Disposer } from './reactive/watch.ts'

/**
 * The `bind:element` adaptor taking files dropped on the element, and pasted into it where `paste`
 * says so. It writes `data-dragging` on the element while files are dragged over it.
 *
 * @param onFiles what takes the accepted files, handed the `drop` or `paste` that carried them; not
 *   called where none was accepted
 * @param options which files are taken, and whether a paste is a drop
 */
export function dropzone(
    onFiles: (files: File[], event: DragEvent | ClipboardEvent) => void,
    options: {
        /**
         * The files taken. A string is written as an `<input type="file">`'s `accept`: MIME types,
         * `image/*` wildcards and `.pdf` extensions, separated by commas. A function is handed the
         * transfer and answers the files it takes, as `imageFiles` does for the images a model is
         * shown. Every file by default.
         */
        accept?: string | ((data: DataTransfer | null) => File[])
        /** Whether a paste of files into the element is taken as a drop. `false` by default. */
        paste?: boolean
        /** Whether more than the first accepted file is taken. `true` by default. */
        multiple?: boolean
    } = {},
): (element: Element) => Disposer {
    const { accept = '', paste = false, multiple = true } = options
    const select =
        typeof accept === 'function' ? accept : acceptedBy(acceptOf(accept))
    const taken = (data: DataTransfer | null): File[] => {
        const files = select(data)
        return multiple || files.length < 2 ? files : files.slice(0, 1)
    }
    return (element) => {
        // A drag crossing into a child enters it before it leaves the parent: entries count, so the
        // attribute stays until the drag has left them all.
        let entered = 0
        const enter = (event: Event): void => {
            if (!carriesFiles(event as DragEvent)) return
            event.preventDefault()
            entered += 1
            if (entered === 1) element.setAttribute('data-dragging', '')
        }
        const over = (event: Event): void => {
            if (!carriesFiles(event as DragEvent)) return
            // A drop lands only where `dragover` was refused its default.
            event.preventDefault()
            const transfer = (event as DragEvent).dataTransfer
            if (transfer !== null) transfer.dropEffect = 'copy'
        }
        const leave = (event: Event): void => {
            if (!carriesFiles(event as DragEvent) || entered === 0) return
            entered -= 1
            if (entered === 0) element.removeAttribute('data-dragging')
        }
        const drop = (event: Event): void => {
            if (!carriesFiles(event as DragEvent)) return
            // 53.18 — refused even with nothing accepted, or the browser opens the file in the tab.
            event.preventDefault()
            entered = 0
            element.removeAttribute('data-dragging')
            const files = taken((event as DragEvent).dataTransfer)
            if (files.length > 0) onFiles(files, event as DragEvent)
        }
        const pasted = (event: Event): void => {
            const files = taken((event as ClipboardEvent).clipboardData)
            // Words pasted alone paste as they always do.
            if (files.length === 0) return
            event.preventDefault()
            onFiles(files, event as ClipboardEvent)
        }
        element.addEventListener('dragenter', enter)
        element.addEventListener('dragover', over)
        element.addEventListener('dragleave', leave)
        element.addEventListener('drop', drop)
        if (paste) element.addEventListener('paste', pasted)
        return () => {
            element.removeEventListener('dragenter', enter)
            element.removeEventListener('dragover', over)
            element.removeEventListener('dragleave', leave)
            element.removeEventListener('drop', drop)
            element.removeEventListener('paste', pasted)
            element.removeAttribute('data-dragging')
        }
    }
}

function carriesFiles(event: DragEvent): boolean {
    const types = event.dataTransfer?.types
    if (types === undefined) return false
    for (const type of types) if (type === 'Files') return true
    return false
}

/** An `accept` list, each entry lowercased and trimmed. */
function acceptOf(accept: string): string[] {
    const entries: string[] = []
    for (const entry of accept.split(','))
        if (entry.trim() !== '') entries.push(entry.trim().toLowerCase())
    return entries
}

/** The files a transfer carries that an `accept` list takes, reading `items` where `files` hold none. */
function acceptedBy(
    accepted: readonly string[],
): (data: DataTransfer | null) => File[] {
    return (data) => {
        const files: File[] = []
        if (data === null) return files
        for (const file of data.files)
            if (accepts(accepted, file)) files.push(file)
        if (data.files.length > 0) return files
        // A pasted file some browsers carry in `items` alone.
        for (const item of data.items) {
            if (item.kind !== 'file') continue
            const file = item.getAsFile()
            if (file !== null && accepts(accepted, file)) files.push(file)
        }
        return files
    }
}

function accepts(accepted: readonly string[], file: File): boolean {
    if (accepted.length === 0) return true
    const type = file.type.toLowerCase()
    const name = file.name.toLowerCase()
    for (const entry of accepted) {
        if (entry.startsWith('.') ? name.endsWith(entry) : entry === type)
            return true
        if (entry.endsWith('/*') && type.startsWith(entry.slice(0, -1)))
            return true
    }
    return false
}
