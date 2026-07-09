import { resolve } from 'node:path'
import { augmentModule } from './augmentModule.ts'
import { carriesBodyArgs } from './carriesBodyArgs.ts'
import { detectRpcMethod } from './detectRpcMethod.ts'
import { fileStem } from './fileStem.ts'
import { RPC_ARGS_TYPE } from './RPC_ARGS_TYPE.ts'
import { rpcUrlForFile } from './rpcUrlForFile.ts'
import type { HttpMethod } from './types/HttpMethod.ts'
import { writeDts } from './writeDts.ts'

/*
Emits a `.d.ts` that augments abide's `RpcRoutes` interface with one entry per
query-carrying $rpc rpc, so `url('/rpc/search', { q })` types its args against
the rpc's own signature. Only GET/DELETE/HEAD (non-body) rpcs are included —
a url() can carry a query string but not a request body, so a POST rpc has no
URL form. `RpcArgs` lifts the args type out of the rpc's RemoteFunction
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
    methodForModule,
}: {
    cwd: string
    rpcDir: string
    rpcFiles: string[]
    importName: string
    /* Warm server-program method resolver (ADR-0025 D2): reads the method off the export's
       helper symbol so an aliased/re-exported helper resolves where `detectRpcMethod`'s
       `RPC_EXPORT` regex misses it. Absent (no warm program) or undefined-per-file falls open to
       the regex, byte-identical to before. */
    methodForModule?: (modulePath: string) => HttpMethod | undefined
}): Promise<void> {
    const pairs = await Promise.all(
        rpcFiles.map(async (file): Promise<[string, string] | undefined> => {
            const method =
                methodForModule?.(resolve(rpcDir, file)) ??
                detectRpcMethod(await Bun.file(`${rpcDir}/${file}`).text())
            // A body rpc's args can't ride a URL — leave it out of the url() rpc map.
            if (!method || carriesBodyArgs(method)) {
                return undefined
            }
            const importPath = `../server/rpc/${file}`
            return [
                rpcUrlForFile(file),
                `RpcArgs<typeof import(${JSON.stringify(importPath)}).${fileStem(file)}>`,
            ]
        }),
    )
    const entries = pairs
        .filter((pair) => pair !== undefined)
        .toSorted(([a], [b]) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1))
    const module = augmentModule(`${importName}/shared/url`, 'RpcRoutes', entries)
    await writeDts(cwd, 'rpc', `${RPC_ARGS_TYPE}\n\n${module}`)
}
