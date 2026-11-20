// ONE TRANSFER, ONE LIST OF FILES. A pasted file some browsers carry in `items` alone is read out with
// `getAsFile`, which hands a new `File` each time it is asked — so what a transfer carries is read once
// and kept for it, and the files one reader took are the same objects another compares them against.
const READ = new WeakMap<DataTransfer, File[]>()

/** The files a drop or a paste carries: its `files`, or the files in its `items` where `files` hold none. */
export function filesOf(data: DataTransfer | null): readonly File[] {
    if (data === null) return []
    if (data.files.length > 0) return [...data.files]
    const kept = READ.get(data)
    if (kept !== undefined) return kept
    const files: File[] = []
    for (const item of data.items) {
        if (item.kind !== 'file') continue
        const file = item.getAsFile()
        if (file !== null) files.push(file)
    }
    READ.set(data, files)
    return files
}
