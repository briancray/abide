import { augmentModule } from './augmentModule.ts'
import { fileStem } from './fileStem.ts'
import { socketNameForFile } from './socketNameForFile.ts'
import { writeDts } from './writeDts.ts'

/*
Emits a `.d.ts` that augments createTestApp's `SocketClient` interface with one
entry per $socket, keyed by socket name (the same key `app.sockets.<name>`
resolves at runtime). The `socket(...)` helper statically returns `Socket<T>`,
so each entry is the export's own type directly — `app.sockets.chat` types as
`Socket<ChatMessage>`, iterable for the live stream with `.tail`/`.publish`.
Written to `src/.abide/testSockets.d.ts` like its rpc sibling.
*/
export async function writeTestSocketsDts({
    cwd,
    socketFiles,
    importName,
}: {
    cwd: string
    socketFiles: string[]
    importName: string
}): Promise<void> {
    const entries = socketFiles
        .map((file): [string, string] => {
            const importPath = `../server/sockets/${file}`
            return [
                socketNameForFile(file),
                `typeof import(${JSON.stringify(importPath)}).${fileStem(file)}`,
            ]
        })
        .toSorted(([a], [b]) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1))
    const module = augmentModule(`${importName}/test/createTestApp`, 'SocketClient', entries)
    await writeDts(cwd, 'testSockets', module)
}
