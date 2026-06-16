import { dirname, join } from 'node:path'
import { serverBinaryFilename } from './serverBinaryFilename.ts'

/*
Locates the embedded server binary that ships beside the launcher inside a
bundle. The launcher's own path is `process.execPath` (the compiled binary
itself), so the server sits in the same directory — true for both the
flat-directory layout and a macOS `.app`'s `Contents/MacOS/`.
*/
export function resolveServerBinary(): string {
    return join(dirname(process.execPath), serverBinaryFilename())
}
