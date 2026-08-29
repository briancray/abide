// A minimal ZIP writer. STORED (method 0) rather than deflate: an example is a few
// kB of text, so compression buys nothing a reader would notice and costs the one
// thing worth having here — no dependency and no system `zip` on the path.
// `Bun.hash.crc32` is the only piece that would otherwise need a lookup table.

const LOCAL_HEADER = 0x04034b50
const CENTRAL_HEADER = 0x02014b50
const END_OF_CENTRAL = 0x06054b50
const UTF8_NAMES = 0x800
// A fixed DOS timestamp (1980-01-01), so the same sources always build the same bytes.
const DOS_TIME = 0
const DOS_DATE = 0x0021

export type ZipEntry = { path: string; source: string }

export function zip(entries: ZipEntry[]): Uint8Array {
    const encoder = new TextEncoder()
    const files = entries.map((entry) => {
        const name = encoder.encode(entry.path)
        const body = encoder.encode(entry.source)
        return { name, body, crc: Bun.hash.crc32(body) >>> 0, offset: 0 }
    })

    let size = 0
    for (const file of files)
        size += 30 + file.name.length + file.body.length + 46 + file.name.length
    size += 22

    const output = new Uint8Array(size)
    const view = new DataView(output.buffer)
    let at = 0

    for (const file of files) {
        file.offset = at
        view.setUint32(at, LOCAL_HEADER, true)
        view.setUint16(at + 4, 20, true) // version needed
        view.setUint16(at + 6, UTF8_NAMES, true)
        view.setUint16(at + 8, 0, true) // stored
        view.setUint16(at + 10, DOS_TIME, true)
        view.setUint16(at + 12, DOS_DATE, true)
        view.setUint32(at + 14, file.crc, true)
        view.setUint32(at + 18, file.body.length, true)
        view.setUint32(at + 22, file.body.length, true)
        view.setUint16(at + 26, file.name.length, true)
        view.setUint16(at + 28, 0, true) // no extra field
        at += 30
        output.set(file.name, at)
        at += file.name.length
        output.set(file.body, at)
        at += file.body.length
    }

    const centralAt = at
    for (const file of files) {
        view.setUint32(at, CENTRAL_HEADER, true)
        view.setUint16(at + 4, 20, true) // version made by
        view.setUint16(at + 6, 20, true) // version needed
        view.setUint16(at + 8, UTF8_NAMES, true)
        view.setUint16(at + 10, 0, true) // stored
        view.setUint16(at + 12, DOS_TIME, true)
        view.setUint16(at + 14, DOS_DATE, true)
        view.setUint32(at + 16, file.crc, true)
        view.setUint32(at + 20, file.body.length, true)
        view.setUint32(at + 24, file.body.length, true)
        view.setUint16(at + 28, file.name.length, true)
        view.setUint16(at + 30, 0, true) // extra
        view.setUint16(at + 32, 0, true) // comment
        view.setUint16(at + 34, 0, true) // disk
        view.setUint16(at + 36, 0, true) // internal attrs
        view.setUint32(at + 38, 0, true) // external attrs
        view.setUint32(at + 42, file.offset, true)
        at += 46
        output.set(file.name, at)
        at += file.name.length
    }

    view.setUint32(at, END_OF_CENTRAL, true)
    view.setUint16(at + 4, 0, true) // this disk
    view.setUint16(at + 6, 0, true) // disk with central directory
    view.setUint16(at + 8, files.length, true)
    view.setUint16(at + 10, files.length, true)
    view.setUint32(at + 12, at - centralAt, true)
    view.setUint32(at + 16, centralAt, true)
    view.setUint16(at + 20, 0, true) // no comment

    return output
}
