import { augmentModule } from './augmentModule.ts'
import { commandNameForUrl } from './commandNameForUrl.ts'
import { fileStem } from './fileStem.ts'
import { RPC_ARGS_TYPE } from './RPC_ARGS_TYPE.ts'
import { rpcUrlForFile } from './rpcUrlForFile.ts'
import { writeDts } from './writeDts.ts'

/*
Emits a `.d.ts` that augments createTestApp's `RpcClient` interface with one
entry per $rpc rpc, keyed by command name (the same key `app.rpc.<name>`
resolves at runtime). Each entry lifts the rpc's args + resolved return out of
its RemoteFunction so `app.rpc.getProduct({ id })` types against the rpc's own
signature — args in, decoded body out, plus `.raw` for the Response. `RpcArgs`
drops the FormData upload variant exactly as writeRpcDts does; `RpcReturn`
reads the resolved body type. Written to `src/.abide/testRpc.d.ts` so the
consumer's src tsconfig include picks it up, keyed on the project's abide
import name.
*/
export async function writeTestRpcDts({
    cwd,
    rpcFiles,
    importName,
}: {
    cwd: string
    rpcFiles: string[]
    importName: string
}): Promise<void> {
    const entries = rpcFiles
        .map((file): [string, string] => {
            const name = commandNameForUrl(rpcUrlForFile(file))
            const importPath = `../server/rpc/${file}`
            return [
                name,
                `RpcInvoker<typeof import(${JSON.stringify(importPath)}).${fileStem(file)}>`,
            ]
        })
        .toSorted(([a], [b]) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1))
    const helperTypes = `${RPC_ARGS_TYPE}
type RpcReturn<Fn> = Fn extends (...args: never[]) => Promise<infer Return> ? Return : never
type RpcInvoker<Fn> = ((args?: RpcArgs<Fn>) => Promise<RpcReturn<Fn>>) & {
    raw: (args?: RpcArgs<Fn>) => Promise<Response>
}`
    const module = augmentModule(`${importName}/test/createTestApp`, 'RpcClient', entries)
    await writeDts(cwd, 'testRpc', `${helperTypes}\n\n${module}`)
}
