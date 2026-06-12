// node:fs existsSync — cheap sync presence check, mirrors createPublicAssetServer
import { existsSync } from 'node:fs'
import { Glob } from 'bun'
import { mimeForExtension } from '../server/runtime/mimeForExtension.ts'
import type { Assets } from '../server/runtime/types/Assets.ts'
import type { McpResourceContents } from './types/McpResourceContents.ts'
import type { McpResourceDescriptor } from './types/McpResourceDescriptor.ts'
import type { McpResourceServer } from './types/McpResourceServer.ts'

/*
The belte:// URI namespace for file-based resources. A resource's URI is this
prefix followed by its path relative to src/mcp/resources.
*/
const URI_PREFIX = 'belte://resources/'

/*
MIME essences returned inline as UTF-8 `text` in resources/read; everything
else is returned as a base64 `blob`. The essence is taken before any `;charset`
parameter that Bun.file().type appends.
*/
function isTextMime(mime: string): boolean {
    // split() always yields a first element; the '' default exists for noUncheckedIndexedAccess in consumer tsconfigs.
    const essence = (mime.split(';')[0] ?? '').trim()
    return (
        essence.startsWith('text/') ||
        essence === 'application/json' ||
        essence === 'application/xml' ||
        essence === 'image/svg+xml' ||
        essence.endsWith('+json') ||
        essence.endsWith('+xml')
    )
}

function descriptorFor(relativePath: string): McpResourceDescriptor {
    return {
        uri: `${URI_PREFIX}${relativePath}`,
        name: relativePath,
        mimeType: mimeForExtension(relativePath),
    }
}

function contentsFor(relativePath: string, bytes: Uint8Array): McpResourceContents {
    const mimeType = mimeForExtension(relativePath)
    const uri = `${URI_PREFIX}${relativePath}`
    if (isTextMime(mimeType)) {
        return { uri, mimeType, text: new TextDecoder().decode(bytes) }
    }
    return { uri, mimeType, blob: bytes.toBase64() }
}

/*
Serves files under src/mcp/resources as MCP resources. Two sources, picked at
construction (mirrors createPublicAssetServer):
  - `mcpResources` (standalone compile): a map of relative-path → zstd bytes
    embedded into the binary.
  - `resourcesDir` on disk (dev + `belte start`): files read straight from
    `${cwd}/src/mcp/resources`.
*/
export function createMcpResourceServer({
    resourcesDir,
    mcpResources,
}: {
    resourcesDir: string
    mcpResources?: Assets
}): McpResourceServer {
    return {
        async list(): Promise<McpResourceDescriptor[]> {
            if (mcpResources) {
                return Object.keys(mcpResources).map(descriptorFor)
            }
            if (!existsSync(resourcesDir)) {
                return []
            }
            const files = await Array.fromAsync(
                new Glob('**/*').scan({ cwd: resourcesDir, onlyFiles: true }),
            )
            return files.map(descriptorFor)
        },
        async read(uri: string): Promise<McpResourceContents | undefined> {
            if (!uri.startsWith(URI_PREFIX)) {
                return undefined
            }
            const relativePath = uri.slice(URI_PREFIX.length)
            // reject `..` traversal in the requested uri before any disk read
            if (relativePath.split('/').includes('..')) {
                return undefined
            }
            if (mcpResources) {
                const compressed = mcpResources[relativePath]
                if (!compressed) {
                    return undefined
                }
                return contentsFor(relativePath, await Bun.zstdDecompress(compressed))
            }
            const file = Bun.file(`${resourcesDir}/${relativePath}`)
            if (!(await file.exists())) {
                return undefined
            }
            return contentsFor(relativePath, await file.bytes())
        },
    }
}
