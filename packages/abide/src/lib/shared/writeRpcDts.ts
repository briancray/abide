import { carriesBodyArgs } from './carriesBodyArgs.ts'
import { detectRpcMethod } from './detectRpcMethod.ts'
import { fileStem } from './fileStem.ts'
import { rpcUrlForFile } from './rpcUrlForFile.ts'
import { writeDts } from './writeDts.ts'

/*
Emits a `.d.ts` that augments abide's `RpcRoutes` interface with one entry per
query-carrying $rpc verb, so `url('/rpc/search', { q })` types its args against
the verb's own signature. Only GET/DELETE/HEAD (non-body) verbs are included —
a url() can carry a query string but not a request body, so a POST verb has no
URL form. `RpcArgs` lifts the args type out of the verb's RemoteFunction
(dropping the FormData upload variant); the file path resolves the export by
its filename, the abide one-export-per-file convention. Written to
`src/.abide/rpc.d.ts` so the consumer's src tsconfig include picks it up, keyed
on the project's abide import name like writeRoutesDts.
*/
export async function writeRpcDts({
    cwd,
    rpcDir,
    rpcFiles,
    importName,
}: {
    cwd: string
    rpcDir: string
    rpcFiles: string[]
    importName: string
}): Promise<void> {
    const lines = await Promise.all(
        rpcFiles.map(async (file) => {
            const method = detectRpcMethod(await Bun.file(`${rpcDir}/${file}`).text())
            // A body verb's args can't ride a URL — leave it out of the url() rpc map.
            if (!method || carriesBodyArgs(method)) {
                return undefined
            }
            const importPath = `../server/rpc/${file}`
            return `        ${JSON.stringify(rpcUrlForFile(file))}: RpcArgs<typeof import(${JSON.stringify(importPath)}).${fileStem(file)}>`
        }),
    )
    const entries = lines.filter((line) => line !== undefined).toSorted()
    const body = `type RpcArgs<Fn> = Fn extends (args: infer Args) => unknown ? Exclude<Args, FormData> : never

declare module '${importName}/shared/url' {
    interface RpcRoutes {
${entries.join('\n')}
    }
}`
    await writeDts(cwd, 'rpc', body)
}
