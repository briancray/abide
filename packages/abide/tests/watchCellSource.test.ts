import { beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { collectAbideDiagnostics } from '../src/lib/ui/compile/collectAbideDiagnostics.ts'
import { compileModule } from '../src/lib/ui/compile/compileModule.ts'
import { createShadowProgram } from '../src/lib/ui/compile/createShadowProgram.ts'
import { scope } from '../src/lib/ui/runtime/scope.ts'
import { state } from '../src/lib/ui/state.ts'
import { watch } from '../src/lib/ui/watch.ts'
import { installMiniDom } from './support/installMiniDom.ts'

/*
`watch(cell, handler)` — the documented 2-arg cell form — used to be dead: the read-lowering
turned the cell source into a VALUE (`watch($$model.read("count"), …)`), so the runtime `watch`
never got a reactive source to subscribe to, and the shadow (cell projected to its value type)
couldn't match any `watch` overload. Both halves are locked here: the compiler folds a cell
source into the auto-tracked thunk form, and the shadow types the handler off the cell's value.
*/

const PACKAGE_ROOT = resolve(import.meta.dir, '..')

beforeAll(() => {
    installMiniDom()
})

function shadowDiagnostics(component: string): string[] {
    const dir = mkdtempSync(join(tmpdir(), 'abide-watch-'))
    writeFileSync(
        join(dir, 'tsconfig.json'),
        JSON.stringify({
            compilerOptions: {
                target: 'ESNext',
                module: 'ESNext',
                moduleResolution: 'bundler',
                lib: ['ESNext', 'DOM', 'DOM.Iterable'],
                strict: true,
                allowImportingTsExtensions: true,
                noEmit: true,
                baseUrl: PACKAGE_ROOT,
                paths: { '@abide/abide/*': ['src/lib/*'] },
            },
        }),
    )
    const path = join(dir, 'component.abide')
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, component)
    return collectAbideDiagnostics(createShadowProgram(dir))
        .filter((diagnostic) => diagnostic.file.endsWith('component.abide'))
        .map((diagnostic) => diagnostic.message)
}

describe('watch(cell, handler) lowering', () => {
    /* The compiler folds a cell source into `watch(() => (handler)(<reactive read>))` — the
       auto-tracked effect form — instead of passing the one-time value read. */
    test('a cell source is folded to the auto-tracked thunk form (not a value read)', () => {
        const { code } = compileModule(
            `<script>
import { state } from '@abide/abide/ui/state'
import { watch } from '@abide/abide/ui/watch'
let count = state(0)
let doubled = state.computed(() => count * 2)
watch(count, (n) => console.log(n))
watch(doubled, (d) => console.log(d))
watch([count, doubled], (vals) => console.log(vals))
</script>
<p>{count}{doubled}</p>
`,
            {},
        )
        /* The state watch reads the cell reactively inside the thunk. */
        expect(code).toContain('watch(() => ((n) => console.log(n))($$model.read("count")))')
        /* The computed watch reads the derive; the array watch reads each element. */
        expect(code).toContain('watch(() => ((d) => console.log(d))(doubled()))')
        expect(code).toContain(
            'watch(() => ((vals) => console.log(vals))([$$model.read("count"), doubled()]))',
        )
        /* The dead form — a value handed to `watch` as its source — must never reappear. */
        expect(code).not.toContain('watch($$model.read(')
        expect(code).not.toContain('watch(doubled(),')
    })

    /* A socket / non-cell source is left for the runtime's own source dispatch — never folded. */
    test('a non-cell (socket/rpc) source is left untouched', () => {
        const { code } = compileModule(
            `<script>
import { watch } from '@abide/abide/ui/watch'
import { chat } from '$server/sockets/chat.ts'
watch(chat, (frame) => console.log(frame))
</script>
<p>hi</p>
`,
            {},
        )
        expect(code).toContain('watch(chat, (frame) => console.log(frame))')
    })

    /* The shadow types `handler`'s parameter off the cell's VALUE, so a clean read passes and a
       wrong member is caught (proof the value type flows, not `any`). */
    test('the shadow type-checks a cell watch against the value type', () => {
        expect(
            shadowDiagnostics(
                `<script>
import { state } from '@abide/abide/ui/state'
import { watch } from '@abide/abide/ui/watch'
let count = state(0)
let doubled = state.computed(() => count * 2)
watch(count, (n) => console.log(n.toFixed(2)))
watch(doubled, (d) => console.log(d + 1))
watch([count, doubled], (vals) => console.log(vals.length))
</script>
<p>{count}{doubled}</p>
`,
            ),
        ).toEqual([])

        const wrong = shadowDiagnostics(
            `<script>
import { state } from '@abide/abide/ui/state'
import { watch } from '@abide/abide/ui/watch'
let count = state(0)
watch(count, (n) => console.log(n.toUpperCase()))
</script>
<p>{count}</p>
`,
        )
        expect(wrong).toHaveLength(1)
        expect(wrong[0]).toContain('toUpperCase')
    })

    /* The inert member-expression form `watch(s.foo, handler)` isn't foldable (abide has no
       per-property cells), so it compiles unchanged AND emits a compile warning naming the base
       cell and the corrective forms — the footgun is loud rather than silent. */
    test('a member-access source on a cell warns and is left unfolded', () => {
        const warnings: string[] = []
        const originalWarn = console.warn
        console.warn = (...args: unknown[]) => {
            warnings.push(args.map(String).join(' '))
        }
        let code = ''
        try {
            ;({ code } = compileModule(
                `<script>
import { state } from '@abide/abide/ui/state'
import { watch } from '@abide/abide/ui/watch'
let s = state({ foo: 1, bar: 2 })
watch(s.foo, (foo) => console.log(foo))
</script>
<p>{s}</p>
`,
                {},
            ))
        } finally {
            console.warn = originalWarn
        }
        /* Not folded — the member source flows through to the read-lowering untouched. */
        expect(code).not.toContain('watch(() =>')
        /* A warning fired, naming the offending source and the base cell. */
        const watchWarning = warnings.find((warning) => warning.includes('does not track'))
        expect(watchWarning).toBeDefined()
        expect(watchWarning).toContain('watch(s.foo, …)')
        expect(watchWarning).toContain('watch(s, v => …)')
    })

    /* A bare cell source must NOT trip the member-expression warning — only member access does. */
    test('a bare cell source does not warn', () => {
        const warnings: string[] = []
        const originalWarn = console.warn
        console.warn = (...args: unknown[]) => {
            warnings.push(args.map(String).join(' '))
        }
        try {
            compileModule(
                `<script>
import { state } from '@abide/abide/ui/state'
import { watch } from '@abide/abide/ui/watch'
let count = state(0)
watch(count, (n) => console.log(n))
</script>
<p>{count}</p>
`,
                {},
            )
        } finally {
            console.warn = originalWarn
        }
        expect(warnings.some((warning) => warning.includes('does not track'))).toBe(false)
    })

    /* End-to-end: the shape the compiler now emits (`watch(() => (handler)(<cell read>))`) is an
       auto-tracked effect, so it fires the handler with the cell's value initially AND on every
       change — the reaction the old value-source lowering silently dropped. */
    test('the folded thunk form reacts to cell changes', () => {
        const count = state(0)
        const seen: (number | undefined)[] = []
        const dispose = scope(() => {
            /* Exactly what `watch(count, (n) => …)` lowers to: the handler applied to the cell
               read, inside the auto-tracked thunk. */
            watch(() => {
                ;((n: number | undefined) => {
                    seen.push(n)
                })(count.value)
            })
        })
        expect(seen).toEqual([0])
        count.value = 1
        count.value = 2
        expect(seen).toEqual([0, 1, 2])
        dispose()
        /* Disposed: a later change no longer fires. */
        count.value = 3
        expect(seen).toEqual([0, 1, 2])
    })
})
