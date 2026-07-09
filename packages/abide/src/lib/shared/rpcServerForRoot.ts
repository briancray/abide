import { createRpcServerProgram, type RpcServerProgram } from './createRpcServerProgram.ts'

/*
Warm per-root accessor for the rpc server program (ADR-0025 D1), mirroring the UI shadow's
`interpolationClassifierForRoot`: the first rpc transform in a root builds the `ts.Program`,
every later transform (streaming/method/outbox query) reuses it. Fails open in two layers — a
program that can't build stores `undefined` so the root is not retried and every query falls
back to the char-scan/regex (each query method also catches per-query throws). The cache lives
in the resolver plugin's `setup` closure, so it persists across a whole build and is dropped
between plugin instances.
*/
export function rpcServerForRoot(
    cache: Map<string, RpcServerProgram | undefined>,
    cwd: string,
    rpcDir: string,
): RpcServerProgram | undefined {
    if (!cache.has(cwd)) {
        try {
            cache.set(cwd, createRpcServerProgram(cwd, rpcDir))
        } catch {
            cache.set(cwd, undefined)
        }
    }
    return cache.get(cwd)
}
