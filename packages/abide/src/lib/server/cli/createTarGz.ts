/*
Minimal ustar tarball writer. Each entry is a 512-byte header followed
by the content padded to a 512-byte boundary; the archive ends with two
512-byte zero blocks. After assembly the buffer is gzipped via
Bun.gzipSync — no external `tar` invocation, no extra deps.

Format constraints:
  - File names ≤ 100 bytes (we never write longer paths).
  - Numeric fields are zero-padded octal ASCII strings (POSIX rule).
  - Checksum is the sum of all header bytes treating the checksum
    field as spaces; encoded as 6 octal digits + NUL + space.
*/

type TarEntry = {
    name: string
    content: Uint8Array
    mode?: number
}

const BLOCK = 512
const ENC = new TextEncoder()

function writeString(buf: Uint8Array, offset: number, length: number, value: string): void {
    const bytes = ENC.encode(value)
    buf.set(bytes.subarray(0, Math.min(bytes.length, length)), offset)
}

function writeOctal(buf: Uint8Array, offset: number, length: number, value: number): void {
    // length-1 octal digits + trailing NUL
    const oct = value.toString(8).padStart(length - 1, '0')
    writeString(buf, offset, length - 1, oct)
    buf[offset + length - 1] = 0
}

function buildHeader(entry: TarEntry): Uint8Array {
    const header = new Uint8Array(BLOCK)
    writeString(header, 0, 100, entry.name)
    writeOctal(header, 100, 8, entry.mode ?? 0o644)
    writeOctal(header, 108, 8, 0)
    writeOctal(header, 116, 8, 0)
    writeOctal(header, 124, 12, entry.content.length)
    writeOctal(header, 136, 12, Math.floor(Date.now() / 1000))
    header.fill(0x20, 148, 156)
    header[156] = 0x30 // '0' = regular file
    writeString(header, 257, 6, 'ustar\0')
    writeString(header, 263, 2, '00')
    // Checksum: sum of all bytes with checksum field treated as spaces.
    let sum = 0
    for (let index = 0; index < BLOCK; index++) {
        sum += header[index] ?? 0
    }
    writeOctal(header, 148, 7, sum)
    header[155] = 0x20 // trailing space after checksum digits
    return header
}

/*
Builds a gzipped tarball from the given entries and returns the bytes.
Sized eagerly (sum of headers + padded contents + 2 trailing blocks).
*/
export function createTarGz(entries: TarEntry[]): Uint8Array<ArrayBuffer> {
    let totalSize = BLOCK * 2 // trailing zero blocks
    for (const entry of entries) {
        totalSize += BLOCK
        totalSize += Math.ceil(entry.content.length / BLOCK) * BLOCK
    }
    const tar = new Uint8Array(totalSize)
    let offset = 0
    for (const entry of entries) {
        tar.set(buildHeader(entry), offset)
        offset += BLOCK
        tar.set(entry.content, offset)
        offset += Math.ceil(entry.content.length / BLOCK) * BLOCK
    }
    /* gzipSync allocates a fresh plain ArrayBuffer; @types/bun widens it to ArrayBufferLike, which BodyInit rejects. */
    return Bun.gzipSync(tar) as Uint8Array<ArrayBuffer>
}
