/*
Test-harness bridge for the reserved `$$` codegen namespace.

The compiler emits every injected runtime name in `$$`-prefixed form (`$$each`,
`$$model`, `$$props`, …) so a user variable can never collide with it. But the
~45 `ui*.test.ts` harnesses run compiled bodies through `new Function(...names,
body)`, injecting the runtime by its BARE name. `withReserved(body)` prepends a
prelude that aliases each injected bare name to its `$$` form, so a body emitting
`$$each(...)` runs under a harness that injects `each`. The aliases are
`typeof`-guarded, so a name a given harness does not inject is simply skipped
(left `undefined`, never referenced because that helper wasn't emitted either).

This is the harness side of the runtime-injection coupling (cf. doc-key escaping):
production modules get `$$`-names from their aliased imports; tests get them here.
*/

/* `$$` + the name without any leading `$` — `each`→`$$each`, `$props`→`$$props`. */
export function reserved(name: string): string {
    return `$$${name.replace(/^\$+/, '')}`
}

/* Every bare name the compiler may emit in `$$` form: the `UI_RUNTIME_IMPORTS`
   helpers, the doc/reactive substrate, and the structural locals/params. */
const RESERVED_BARE_NAMES = [
    'snippet',
    'scope',
    'enterScope',
    'exitScope',
    'effect',
    'mount',
    'appendText',
    'appendTextAt',
    'appendSnippet',
    'appendStatic',
    'cloneStatic',
    'skeleton',
    'anchorCursor',
    'attr',
    'on',
    'attach',
    'each',
    'eachAsync',
    'when',
    'awaitBlock',
    'tryBlock',
    'switchBlock',
    'mountSlot',
    'outlet',
    'mountChild',
    'mergeProps',
    'spreadProps',
    'restProps',
    'spreadAttrs',
    'readCall',
    'hydrate',
    'escapeKey',
    'nextBlockId',
    'enterRenderPass',
    'exitRenderPass',
    'doc',
    'state',
    'computed',
    'linked',
    'model',
    '$props',
    '$ctx',
    '$children',
    'host',
    'build',
]

const PRELUDE = `${RESERVED_BARE_NAMES.map(
    (name) => `var ${reserved(name)} = (typeof ${name} !== 'undefined' ? ${name} : undefined);`,
).join('')}\n`

/* Prepends the reserved-alias prelude to a compiled body so it runs under a
   harness that injects the bare runtime names. */
export function withReserved(body: string): string {
    return PRELUDE + body
}
