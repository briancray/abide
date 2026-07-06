import { resolve } from 'node:path'
import { NO_STORE } from '../../shared/CACHE_CONTROL_VALUES.ts'
import { isLayoutFile } from '../../shared/isLayoutFile.ts'
import { compileModule } from '../../ui/compile/compileModule.ts'

// Reused across requests — strips the embedded author TypeScript to browser JS.
const TRANSPILER = new Bun.Transpiler({ loader: 'ts' })

/*
Serves one edited `.abide`'s hot module (dev component HMR). Compiles it in hot
mode — runtime sourced from `window.__abide`, self-invoking `hotReplace` — and
transpiles the embedded author TypeScript to plain JS the browser can import
directly (the normal pipeline relies on the bundler's `ts` loader for this). The
browser imports this in place of a reload; on load it swaps the component's live
instances. The id is guarded as a project-relative `.abide` under cwd; a bad
module ID returns 400; a missing file 404s so the client falls back to a reload.
*/
export async function devHotModuleResponse(moduleId: string): Promise<Response> {
    const root = process.cwd()
    const path = resolve(root, moduleId)
    if (!moduleId.endsWith('.abide') || !path.startsWith(`${root}/`)) {
        return new Response('bad request', { status: 400 })
    }
    const source = await Bun.file(path)
        .text()
        .catch(() => undefined)
    if (source === undefined) {
        return new Response('not found', { status: 404 })
    }
    const { code } = compileModule(source, {
        isLayout: isLayoutFile(moduleId),
        moduleId,
        hot: true,
    })
    return new Response(TRANSPILER.transformSync(code), {
        headers: {
            'Content-Type': 'application/javascript; charset=utf-8',
            'Cache-Control': NO_STORE,
        },
    })
}
