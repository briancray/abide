import type { Mount } from './mountHandlers.ts'

/**
 * The row of a handler file (16.73): its default, answered at the route the file is placed at and
 * named for the file — what its declaration says of it laid over that.
 */
export function handlerFileMount(
    file: Pick<Mount, 'address' | 'source' | 'scope' | 'matchers'>,
    declared: Pick<
        Mount,
        | 'method'
        | 'ui'
        | 'cli'
        | 'mcp'
        | 'description'
        | 'copy'
        | 'defaults'
        | 'args'
        | 'result'
    >,
): Mount {
    return {
        address: file.address,
        method: declared.method,
        source: file.source,
        name: file.address.slice(file.address.lastIndexOf('/') + 1),
        export: 'default',
        scope: file.scope,
        matchers: file.matchers,
        private: false,
        ui: declared.ui,
        cli: declared.cli,
        mcp: declared.mcp,
        description: declared.description,
        copy: declared.copy,
        defaults: declared.defaults,
        args: declared.args,
        result: declared.result,
    }
}
