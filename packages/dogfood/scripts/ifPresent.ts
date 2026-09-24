// A read that answers `undefined` where the file is not there, in one syscall rather than an
// `.exists()` ahead of it. Narrowed to that one code: a file that exists and cannot be read is a
// different fault, and must not read as an absent one.
export async function ifPresent<T>(read: Promise<T>): Promise<T | undefined> {
    try {
        return await read
    } catch (thrown) {
        if ((thrown as { code?: unknown }).code !== 'ENOENT') throw thrown
        return undefined
    }
}
