// Where abide declares what the checker and the shadow name by file: each a module of the
// framework's own, as an absolute path in this install. One place, so a module that moves is
// moved once rather than in every reader that found it beside itself.

const besideCompiler = (relative: string): string =>
    Bun.fileURLToPath(new URL(relative, import.meta.url))

export const FRAMEWORK_SOURCES = {
    /** `Reactive`, the type literal every instantiation carries the symbol of (31.3). */
    reactive: besideCompiler('../shared/reactive/Reactive.ts'),
    /** `Selection`, beside the reactive barrel's other names (31.13). */
    selection: besideCompiler('../shared/reactive/index.ts'),
    /** `structural`, the one `identity` a `GET`'s browser copy is handed by name (18.4). */
    structural: besideCompiler('../shared/reactive/structural.ts'),
    props: besideCompiler('../shared/props.ts'),
    route: besideCompiler('../shared/route.ts'),
    /** `RouteParams`. */
    url: besideCompiler('../shared/url.ts'),
    /** The five methods: `GET` is `declare('GET')` there and nowhere else. */
    methods: besideCompiler('../shared/rpc.ts'),
    /** `onConfig` (27.13). */
    hooks: besideCompiler('../server/hooks.ts'),
    /** `request`. */
    requestScope: besideCompiler('../server/requestScope.ts'),
    /** `response`. */
    response: besideCompiler('../server/response.ts'),
    principal: besideCompiler('../shared/principal.ts'),
    cookies: besideCompiler('../shared/cookies.ts'),
    csp: besideCompiler('../shared/csp.ts'),
} as const
