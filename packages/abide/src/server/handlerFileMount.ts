import type { Mount } from './mountHandlers.ts'

/**
 * The row of one verb of a server file's `rpc` (16.73, 16.111): answered at `file.address` and named
 * for its last segment — what its declaration says of it laid over that. `methods` is every verb the
 * export answers, `method` this row's; the default where `exported` names none.
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
        | 'middleware'
        | 'copy'
        | 'defaults'
        | 'args'
        | 'result'
    > &
        Partial<Pick<Mount, 'methods'>>,
    exported = 'default',
): Mount {
    return {
        address: file.address,
        method: declared.method,
        methods: declared.methods ?? [declared.method],
        source: file.source,
        name: file.address.slice(file.address.lastIndexOf('/') + 1),
        export: exported,
        scope: file.scope,
        matchers: file.matchers,
        private: false,
        ui: declared.ui,
        cli: declared.cli,
        mcp: declared.mcp,
        description: declared.description,
        middleware: declared.middleware,
        copy: declared.copy,
        defaults: declared.defaults,
        args: declared.args,
        result: declared.result,
    }
}
