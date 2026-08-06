// The seam. One plugin, two lanes, two transport kinds, one id function — which is the point: the
// browser's stub and the server's registration are emitted by the same pass over the same file, so
// they cannot disagree about what an endpoint is called.
//
// The lane is read off `build.config`: the bundler populates it (`target: "browser"` for both
// `Bun.build` and the dev server's HTML routes) and the runtime `plugin()` registration leaves it
// undefined. That is the only discriminator available, and it is checked by a test rather than
// trusted — a wrong answer here ships a database driver to a browser, silently.
//
// The KIND comes from the directory, so the plugin knows which stub to write before it reads the
// file. The filter is a PATH regex either way, which is what rules out a `'use server'` directive:
// a directive lives in the file's text, so recognising one means intercepting every `.ts` in the
// graph and taking responsibility for loading all of them.

import type { BunPlugin } from 'bun'
import { type Endpoint, endpointsOf } from './exports.ts'
import { endpointId, type Kind, kindOf } from './ids.ts'

export const TRANSPORT_MODULE = /\/server\/(rpc|sockets)\/.+\.ts$/

const RPC_MODULE = `${import.meta.dir}/rpc.ts`
const SOCKETS_MODULE = `${import.meta.dir}/sockets.ts`
const REGISTRY_MODULE = `${import.meta.dir}/registry.ts`

/** What the browser gets: the same export names, none of the module they came from. */
export function stub(path: string, kind: Kind, endpoints: Endpoint[]): string {
    if (kind === 'socket') {
        let out = `import { remoteSocket as __socket } from ${JSON.stringify(SOCKETS_MODULE)}\n`
        for (const endpoint of endpoints) {
            out += `export const ${endpoint.name} = __socket(${JSON.stringify(endpointId(path, endpoint.name))})\n`
        }
        return out
    }
    let out = `import { remote as __remote } from ${JSON.stringify(RPC_MODULE)}\n`
    for (const endpoint of endpoints) {
        const id = JSON.stringify(endpointId(path, endpoint.name))
        out += `export const ${endpoint.name} = __remote(${id}, ${JSON.stringify(endpoint.method)})\n`
    }
    return out
}

/**
 * What the server gets: the module unchanged, plus its own address. Appended, so every line the
 * author wrote keeps its number and a stack trace still points at the handler.
 */
export function registration(path: string, kind: Kind, endpoints: Endpoint[]): string {
    if (endpoints.length === 0) return ''
    const pairs = endpoints.map((e) => [endpointId(path, e.name), e.name])
    const names = endpoints.map((e) => e.name).join(', ')
    return (
        `\nimport { register as __register } from ${JSON.stringify(REGISTRY_MODULE)}\n` +
        `__register(${JSON.stringify(kind)}, ${JSON.stringify(pairs)}, { ${names} })\n`
    )
}

export const elidePlugin: BunPlugin = {
    name: 'abide-elide',
    setup(build): void {
        const config = (build as { config?: { target?: string } }).config
        const browser = config?.target === 'browser'
        build.onLoad({ filter: TRANSPORT_MODULE }, async (args) => {
            const kind = kindOf(args.path)
            if (kind === null) return undefined
            const source = await Bun.file(args.path).text()
            const endpoints = endpointsOf(source, args.path, kind)
            const contents = browser
                ? stub(args.path, kind, endpoints)
                : source + registration(args.path, kind, endpoints)
            return { loader: 'ts', contents }
        })
    },
}

export default elidePlugin
