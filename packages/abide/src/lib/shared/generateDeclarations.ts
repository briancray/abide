import { existsSync } from 'node:fs'
import { Glob } from 'bun'
import { abideImportName } from './abideImportName.ts'
import { abideLog } from './abideLog.ts'
import { rpcServerForRoot } from './rpcServerForRoot.ts'
import { scanPages } from './scanPages.ts'
import { writeHealthDts } from './writeHealthDts.ts'
import { writePublicAssetsDts } from './writePublicAssetsDts.ts'
import { writeRoutesDts } from './writeRoutesDts.ts'
import { writeRpcDts } from './writeRpcDts.ts'
import { writeTestRpcDts } from './writeTestRpcDts.ts'
import { writeTestSocketsDts } from './writeTestSocketsDts.ts'

/* Globs a project subtree once, returning [] when the dir is absent so an app
   missing a folder still generates the same (mirrors the plugin's scanDir /
   scanPublicOnce). */
async function scanDir(dir: string, pattern: string, onlyFiles: boolean): Promise<string[]> {
    if (!existsSync(dir)) {
        return []
    }
    return await Array.fromAsync(new Glob(pattern).scan({ cwd: dir, onlyFiles }))
}

/*
The single producer of the dev-editor `.d.ts` artifacts under src/.abide
(routes/rpc/testRpc/testSockets/health/publicAssets). Owned by build() and run
CONCURRENTLY with Bun.build so its one rpc `ts.Program` build (ADR-0025 D2's
alias-aware method detection) hides under the bundle. The runtime server (dev
worker / `abide start`) no longer generates any `.d.ts` at boot — that removed
the per-boot program build. Every `.d.ts` here is a non-critical editor
convenience (CI typechecks via shadow programs, not these files), so the whole
body is guarded: a codegen hiccup LOGS and resolves rather than failing the
build.
*/
export async function generateDeclarations({ cwd }: { cwd: string }): Promise<void> {
    try {
        const rpcDir = `${cwd}/src/server/rpc`
        const socketsDir = `${cwd}/src/server/sockets`
        const pagesDir = `${cwd}/src/ui/pages`
        const publicDir = `${cwd}/src/ui/public`
        const [importName, pagesScan, rpcFiles, socketFiles, publicFiles] = await Promise.all([
            abideImportName(cwd),
            scanPages(pagesDir),
            scanDir(rpcDir, '**/*.ts', false),
            scanDir(socketsDir, '**/*.ts', false),
            scanDir(publicDir, '**/*', true),
        ])
        /* One program per build (ADR-0025 D2): resolve each rpc's method off its export helper
           SYMBOL so an aliased/re-exported helper resolves where writeRpcDts's regex misses it.
           Fails open to undefined, in which case writeRpcDts falls back to its own regex. */
        const rpcServerProgram = rpcServerForRoot(new Map(), cwd, rpcDir)
        const hasAppModule = existsSync(`${cwd}/src/app.ts`)
        await Promise.all([
            writeRoutesDts({ cwd, pageFiles: pagesScan.pageFiles, importName }),
            writeRpcDts({
                cwd,
                rpcDir,
                rpcFiles,
                importName,
                methodForModule: rpcServerProgram
                    ? (modulePath) => rpcServerProgram.methodForModule(modulePath)
                    : undefined,
            }),
            writeTestRpcDts({ cwd, rpcFiles, importName }),
            writeTestSocketsDts({ cwd, socketFiles, importName }),
            writeHealthDts({ cwd, hasAppModule, importName }),
            writePublicAssetsDts({ cwd, publicFiles, importName }),
        ])
    } catch (error) {
        abideLog.error(error)
    }
}
