/*
Template-grammar coverage tokens — derived from the parser, never hardcoded.

The `.abide` template grammar (control-flow blocks + binding/directive attributes)
is public surface but is NOT an `exports` key, so the slug→export checklist can't
catch a missing construct. A hand-typed token list goes stale silently: it kept
testing `<slot>` and `<template name>` (both since removed) and the wrong
`{:elseif}` spelling while missing the new `interpolated` attribute. So this
derives the grammar from its single source every run:

  - block keywords (`{#…}` / `{/…}`) from `readBlock`'s `keyword === '…'` dispatch
  - branch keywords (`{:…}`) from `readBranch`'s dispatch (+ the `else if` variant)
  - `{#for await}` from the for-head `async` flag
  - directive markers (`bind:` / `class:` / `style:` / `attach` / `on…` / `{...}` /
    interpolated) from `readAttributes`' `name.startsWith(…)` / `name === …` dispatch
  - `{children()}` fill point from `atChildrenCall`
  - removed constructs (must NEVER reappear in an example) from the parser's
    `'… was removed …'` throw guards

Emits a coverage manifest (`F <token>` fixed-string, `R <regex>` regex) and a
forbidden manifest. `sync-examples` greps each coverage token across the
kitchen-sink `.abide` files (every one must appear ≥1×) and each forbidden token
(none may appear). Run: `bun run scripts/grammarTokens.ts`.
*/

const ROOT = new URL('../', import.meta.url).pathname
const PARSER = `${ROOT}src/lib/ui/compile/parseTemplate.ts`

const source = await Bun.file(PARSER).text()

/* The body of a named inner function, from its `function <name>(` to the matching
   close at column 4 (`    }`) — the indentation `parseTemplate`'s inner functions
   sit at. Scopes a dispatch search to one function so `keyword === 'else'` in
   `readBranch` doesn't bleed into `readBlock`. */
function functionBody(name: string): string {
    const start = source.indexOf(`function ${name}(`)
    if (start === -1) {
        throw new Error(`[grammarTokens] inner function ${name} not found in parseTemplate.ts`)
    }
    const end = source.indexOf('\n    }', start)
    return source.slice(start, end === -1 ? undefined : end)
}

/* Distinct `keyword === '<word>'` comparisons in a function body — the parser's
   own dispatch IS the keyword set, so adding/removing a block or branch keyword
   updates coverage with no edit here. */
function keywordsIn(body: string): string[] {
    const matches = body.matchAll(/keyword === '([a-z]+)'/g)
    return [...new Set([...matches].map((match) => match[1]))]
}

const blockKeywords = keywordsIn(functionBody('readBlock'))
const branchKeywords = keywordsIn(functionBody('readBranch'))

const coverage: { kind: 'F' | 'R'; token: string }[] = []
const add = (kind: 'F' | 'R', token: string) => coverage.push({ kind, token })

/* Block opens + closes, one pair per keyword (`{#if`…`{/if}`). */
for (const keyword of blockKeywords) {
    add('F', `{#${keyword}`)
    add('F', `{/${keyword}}`)
}

/* `{#for await …}` — derived from the for-head exposing an `async` flag. */
if (functionBody('readBlock').includes('head.async') && blockKeywords.includes('for')) {
    add('F', '{#for await')
}

/* Branch continuations. `else` covers both `{:else}` and the `{:else if}` variant
   the parser splits via `headKeyword(...) === 'if'`. */
for (const keyword of branchKeywords) {
    add('F', `{:${keyword}`)
}
if (source.includes("headKeyword(token.body.slice(4).trim()) === 'if'")) {
    add('F', '{:else if')
}

/* `{children()}` slot-fill — the single fill point that replaced `<slot>`. */
if (source.includes('function atChildrenCall(')) {
    add('F', '{children(')
}

/* Directive markers from `readAttributes`' name dispatch — the literal prefixes
   the parser branches on become the surface syntax. */
const attrBody = functionBody('readAttributes')
const prefixes = [...attrBody.matchAll(/name\.startsWith\('([^']+)'\)/g)].map((match) => match[1])
const exacts = [...attrBody.matchAll(/name === '([^']+)'/g)].map((match) => match[1])
for (const prefix of prefixes) {
    /* `on` is an event prefix, not a literal attribute name — render its shape. */
    if (prefix === 'on') {
        add('R', 'on[a-z]+=\\{')
    } else {
        add('F', prefix) // `bind:`, `class:`, `style:`
    }
}
for (const name of exacts) {
    add('F', `${name}=`) // `attach=`
}
/* Spread + interpolated attribute — distinct `readAttributes` branches, not name
   dispatch. Spread from the `code.startsWith('...')` branch; interpolated from the
   quoted-value branch that emits a `kind: 'interpolated'` node. */
if (attrBody.includes("code.startsWith('...')")) {
    add('F', '{...')
}
if (attrBody.includes("kind: 'interpolated'")) {
    add('R', '="[^"]*\\{[^}]+\\}') // a quoted attribute value mixing literal text + {expr}
}
/* `bind:value={{ get, set }}` — the derived two-way variant (object literal at a
   bind site), worth its own coverage beyond a plain `bind:`. */
add('R', 'bind:[a-z]+=\\{\\{')

/* The two templating-slug exports that are template grammar but ride as values:
   `{#snippet}` is already a block keyword; `html` brands raw HTML via a tagged
   template, surfaced as `html\``. */
add('F', 'html`')

/* Forbidden — constructs the parser throws on (removed). An example using one is
   stale syntax that happens to still be in the corpus; it must be deleted. Each
   token is gated on the guard text so it tracks the parser, not a hand list. */
const forbidden: { kind: 'F' | 'R'; token: string }[] = []
if (source.includes('<slot> element was removed')) {
    forbidden.push({ kind: 'F', token: '<slot' })
}
if (source.includes('<template name> snippet declarations were removed')) {
    forbidden.push({ kind: 'F', token: '<template name' })
}
/* `<template if/each/…>` control directives — derive the removed set from
   `CONTROL_DIRECTIVES` so a plain inert `<template>` (still valid) isn't flagged. */
if (source.includes('control flow was removed')) {
    const setBody = source.slice(source.indexOf('CONTROL_DIRECTIVES = new Set(['))
    const members = [...setBody.slice(0, setBody.indexOf('])')).matchAll(/'([a-z]+)'/g)].map(
        (m) => m[1],
    )
    forbidden.push({ kind: 'R', token: `<template\\s+(${members.join('|')})\\b` })
}

console.log('### coverage (each token must appear >=1x across kitchen-sink .abide)')
for (const { kind, token } of coverage) {
    console.log(`${kind}\t${token}`)
}
console.log('\n### forbidden (removed constructs — none may appear)')
for (const { kind, token } of forbidden) {
    console.log(`${kind}\t${token}`)
}
