// 31.17 — A NAME A PATTERN BINDS TO A `Reactive` IS A NAME. `const { status, step } = pairing()`
// binds two `Reactive`s, and each is read and written by name exactly as `const status =
// reactive(…)` is — in an object or an array pattern, renamed, defaulted or nested, `const` or `let`.
// A plain member beside them stays the value it is.

import { afterAll, expect, test } from 'bun:test'

import { click } from './click.ts'
import { removeTemporaryModules } from './temporaryModule.ts'
import { closeTyped, lower, mountPage } from './typed.ts'

afterAll(closeTyped)
afterAll(removeTemporaryModules)

const PAIRS = `function pairs() {
    return {
        status: reactive('idle'),
        step: reactive(0),
        nested: { deep: reactive('a') },
        list: [reactive(1)],
        maybe: undefined as ReturnType<typeof reactive<number>> | undefined,
        plain: 1,
    }
}
`

// THE REVERTS, run: bind only a declaration's own identifier in `declaredNames`; not one destructured
// name is read or written — the sum lowers as written, `step = 3` rebinds the name, and 0 of the 6
// rewrites below are made. Or drop the `BindingElement` arm from `classifyRead`; the pattern's own
// names are rewritten as reads, and `{ step: renamed() }` is emitted, which does not parse.
test('every pattern form reads and writes a destructured Reactive by name — 31.17', async () => {
    const lowered =
        await lower(`${PAIRS}const { status, step: renamed, nested: { deep }, maybe = reactive(5), plain } = pairs()
const [first] = pairs().list
let { step } = pairs()
const shown = status + renamed + deep + maybe + first + step + plain
step = 3
step++
renamed += 1
deep = 'b'
first = 2`)
    expect(lowered).toContain(
        'const shown = status() + renamed() + deep() + maybe() + first() + step() + plain',
    )
    expect(lowered).toContain('step.set(3)')
    expect(lowered).toContain('step.set(step() + 1)')
    expect(lowered).toContain('renamed.set(renamed() + (1))')
    expect(lowered).toContain("deep.set('b')")
    expect(lowered).toContain('first.set(2)')
    // The pattern itself binds, and reads nothing.
    expect(lowered).toContain(
        'const { status, step: renamed, nested: { deep }, maybe = reactive(5), plain } = pairs()',
    )
})

// A WRITE THROUGH A DESTRUCTURED NAME IS A WRITE TO THE `Reactive` THE PATTERN BOUND, so a reader
// of that member wakes. THE REVERT: the first above; `step += 1` is an assignment to a constant, and
// the build refuses the page before it mounts.
test('a write to a destructured name wakes a reader of the member it bound — 31.17', async () => {
    await mountPage(`<script>
import { reactive } from '@abide/abide'

${PAIRS}const { step } = pairs()
</script>

<button id="next" onclick={() => { step += 1 }}>next</button>
<p id="seen">{step}</p>`)
    expect(document.querySelector('#seen')?.textContent).toBe('0')
    click('#next')
    expect(document.querySelector('#seen')?.textContent).toBe('1')
})
