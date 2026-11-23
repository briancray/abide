// 53.17-53.20, 53.45, 53.56, 53.57 — FILES DROPPED ON AN ELEMENT, pasted into it, or picked through a file
// input, filtered as a file input filters, as parts an app spreads onto a host and an input of its own.

import { filesOf } from './filesOf.ts'
import { type Live, live } from './live.ts'
import { type Reactive, reactive } from './reactive/index.ts'

/** What `dropzone` takes, and what hears it. */
export type DropzoneOptions = {
    /**
     * The files taken. A string is written as an `<input type="file">`'s `accept`: MIME types,
     * `image/*` wildcards and `.pdf` extensions, separated by commas. A function is handed the
     * transfer and answers the files it takes, as `imageFiles` does for the images a model is
     * shown; a pick through `input` is handed to it as a transfer of the files picked. Every file
     * by default.
     */
    accept?: string | ((data: DataTransfer | null) => File[])
    /** Whether a paste of files into the host is taken as a drop. `false` by default; a function is read live. */
    paste?: Live<boolean>
    /** Whether more than the first accepted file is taken. `true` by default; a function is read live. */
    multiple?: Live<boolean>
    /** 49.8 — the files taken last, to read, clear or bind; one of the parts' own by default. */
    files?: Reactive<readonly File[]>
    /** Handed the files a drop, a paste or a pick took, where it took any. */
    onfiles?: (files: File[], event: Event) => void
    /** 53.45 — handed the files a drop, a paste or a pick carried that were not taken, where there are any. */
    onreject?: (files: File[], event: Event) => void
}

/** The parts `dropzone` hands back: `<div {...drop.host}>`, `<input {...drop.input}>`. */
export type DropzoneParts = {
    /** The drop target's attributes: its drag and drop, its paste where `paste` says so, and `data-dragging`. */
    readonly host: Record<string, unknown>
    /** A file input's attributes: the way in by keyboard and screen reader, filtered as a drop is. */
    readonly input: Record<string, unknown>
    /** The files the last drop, paste or pick took. */
    readonly files: Reactive<readonly File[]>
    /** The files the last drop, paste or pick turned away. */
    readonly rejected: readonly File[]
}

/**
 * Files dropped on an element, pasted into it where `paste` says so, or picked through a file input,
 * as parts: the host to drop on, the input to pick with, and the files each took.
 *
 * @param options which files are taken, whether a paste is a drop, and what hears the files
 */
export function dropzone(options: DropzoneOptions = {}): DropzoneParts {
    // 49.11 — read where they are used.
    const multiple = () => live(options.multiple) ?? true
    const taken = (data: DataTransfer | null): File[] => {
        const accept = options.accept ?? ''
        const files =
            typeof accept === 'function'
                ? accept(data)
                : acceptedBy(acceptOf(accept))(data)
        return multiple() || files.length < 2 ? files : files.slice(0, 1)
    }
    const files = options.files ?? reactive<readonly File[]>([])
    const turnedAway = reactive<readonly File[]>([])
    // A drag crossing into a child enters it before it leaves the parent: entries count, so the
    // attribute stays until the drag has left them all.
    const entered = reactive(0)

    // 53.56 — what a drop, a paste or a pick took replaces the files, as a file input's own pick does.
    const took = (data: DataTransfer | null, event: Event): File[] => {
        const kept = taken(data)
        // Matched one for one, so the second of two identical files is turned away where one was taken.
        const unmatched = [...kept]
        const away: File[] = []
        for (const file of filesOf(data)) {
            const at = unmatched.indexOf(file)
            if (at === -1) away.push(file)
            else unmatched.splice(at, 1)
        }
        turnedAway.set(away)
        if (away.length > 0) options.onreject?.(away, event)
        if (kept.length > 0) {
            files.set(kept)
            options.onfiles?.(kept, event)
        }
        return kept
    }

    const host: Record<string, unknown> = {
        ondragenter: (event: DragEvent) => {
            if (!carriesFiles(event)) return
            event.preventDefault()
            entered.set((entered.peek() ?? 0) + 1)
        },
        ondragover: (event: DragEvent) => {
            if (!carriesFiles(event)) return
            // A drop lands only where `dragover` was refused its default.
            event.preventDefault()
            if (event.dataTransfer !== null)
                event.dataTransfer.dropEffect = 'copy'
        },
        ondragleave: (event: DragEvent) => {
            if (!carriesFiles(event) || !entered.peek()) return
            entered.set((entered.peek() ?? 1) - 1)
        },
        ondrop: (event: DragEvent) => {
            if (!carriesFiles(event)) return
            // 53.18 — refused even with nothing accepted, or the browser opens the file in the tab.
            event.preventDefault()
            entered.set(0)
            took(event.dataTransfer, event)
        },
        get 'data-dragging'() {
            return entered() > 0 ? '' : undefined
        },
        // Words pasted alone paste as they always do, and so does everything where `paste` is off.
        onpaste: (event: ClipboardEvent) => {
            if (!(live(options.paste) ?? false)) return
            if (took(event.clipboardData, event).length > 0)
                event.preventDefault()
        },
        'data-dropzone': 'host',
    }

    // 53.57 — a pick through the input is taken as a drop is, and the input emptied after, so the
    // same file picked again is a pick again and what shows is `files`.
    const input: Record<string, unknown> = {
        type: 'file',
        get accept() {
            const accept = options.accept
            return typeof accept === 'string' && accept !== ''
                ? accept
                : undefined
        },
        get multiple() {
            return multiple()
        },
        onchange: (event: Event) => {
            const picker = event.currentTarget as HTMLInputElement
            const transfer = new DataTransfer()
            for (const file of picker.files ?? []) transfer.items.add(file)
            took(transfer, event)
            picker.value = ''
        },
        'data-dropzone': 'input',
    }

    return {
        host,
        input,
        files,
        get rejected() {
            return turnedAway()
        },
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

/** The files a transfer carries that an `accept` list takes. */
function acceptedBy(
    accepted: readonly string[],
): (data: DataTransfer | null) => File[] {
    return (data) => {
        const files: File[] = []
        for (const file of filesOf(data))
            if (accepts(accepted, file)) files.push(file)
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
