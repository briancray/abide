import { commandNameForUrl } from './commandNameForUrl.ts'
import { fileStem } from './fileStem.ts'
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
        .map((file) => {
            const name = commandNameForUrl(rpcUrlForFile(file))
            const importPath = `../server/rpc/${file}`
            return `        ${JSON.stringify(name)}: RpcInvoker<typeof import(${JSON.stringify(importPath)}).${fileStem(file)}>`
        })
        .toSorted()
    const body = `type RpcArgs<Fn> = Fn extends (args: infer Args) => unknown ? Exclude<Args, FormData> : never
type RpcReturn<Fn> = Fn extends (...args: never[]) => Promise<infer Return> ? Return : never
type RpcInvoker<Fn> = ((args?: RpcArgs<Fn>) => Promise<RpcReturn<Fn>>) & {
    raw: (args?: RpcArgs<Fn>) => Promise<Response>
}

declare module '${importName}/test/createTestApp' {
    interface RpcClient {
${entries.join('\n')}
    }
}`
    await writeDts(cwd, 'testRpc', body)
}
