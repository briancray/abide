import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { classifyInterpolationType } from '../src/lib/ui/compile/classifyInterpolationType.ts'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { createShadowProgram } from '../src/lib/ui/compile/createShadowProgram.ts'
import { nodeAtShadowOffset } from '../src/lib/ui/compile/nodeAtShadowOffset.ts'
import { shadowNaming } from '../src/lib/ui/compile/shadowNaming.ts'
import { sourceToShadowOffset } from '../src/lib/ui/compile/sourceToShadowOffset.ts'
import type { InterpolationClassifier } from '../src/lib/ui/compile/types/InterpolationClassifier.ts'

/* A throwaway project on disk — createShadowProgram reads sources via ts.sys, so the
   component and its tsconfig must live as real files for the checker to run. */
const SOURCE = `<script>
async function getPromise(): Promise<string> { return 'x' }
const count: number = 5
</script>
<p>{getPromise()}</p>
<span>{count}</span>
`

/* The same component with the promise interpolation written as an EXPLICIT streaming
   await — the shape type-directed lowering synthesizes. The classified compile of
   SOURCE must equal the plain compile of this. */
const EXPLICIT = `<script>
async function getPromise(): Promise<string> { return 'x' }
const count: number = 5
</script>
<p>{#await getPromise()}{:then __v0}{__v0}{/await}</p>
<span>{count}</span>
`

describe('type-directed interpolation lowering', () => {
    const dir = mkdtempSync(join(tmpdir(), 'abide-typedir-'))
    writeFileSync(
        join(dir, 'tsconfig.json'),
        JSON.stringify({
            compilerOptions: {
                strict: true,
                module: 'esnext',
                moduleResolution: 'bundler',
                target: 'esnext',
                lib: ['esnext', 'dom'],
            },
        }),
    )
    const abidePath = join(dir, 'Component.abide')
    writeFileSync(abidePath, SOURCE)

    /* A shadow-backed classifier over the fixture, built the way the spike /
       classifyInterpolationType.test do: map the interpolation's source offset into
       shadow coordinates, find its expression node, classify its checker type. */
    const { program, shadows } = createShadowProgram(dir, [abidePath])
    const checker = program.getTypeChecker()
    const shadow = shadows.get(abidePath)!
    const shadowFile = program.getSourceFile(shadowNaming.suffixed(abidePath))!
    const classify: InterpolationClassifier = (loc, code) => {
        const offset = sourceToShadowOffset(shadow.mappings, loc)
        if (offset === undefined) {
            return 'sync'
        }
        const node = nodeAtShadowOffset(shadowFile, offset, code.length)
        if (node === undefined) {
            return 'sync'
        }
        return classifyInterpolationType(checker.getTypeAtLocation(node), node, checker)
    }

    test('a promise interpolation lowers to a streaming await (client)', () => {
        const lowered = compileComponent(SOURCE, false, undefined, undefined, classify)
        const explicit = compileComponent(EXPLICIT)
        /* The lowered promise interpolation is byte-for-byte the explicit streaming await. */
        expect(lowered).toBe(explicit)
        expect(lowered).toContain('$$awaitBlock(')
        /* NOT a bare text bind of the promise. */
        expect(lowered).not.toMatch(/\$\$appendText\([^;]*getPromise/)
    })

    test('a promise interpolation lowers to a streaming await (SSR)', () => {
        const lowered = compileSSR(SOURCE, false, undefined, undefined, classify)
        const explicit = compileSSR(EXPLICIT)
        expect(lowered).toBe(explicit)
        /* The streaming-await SSR emission registers on `$awaits` rather than pushing the
           promise as text (which would stringify to `[object Promise]` at runtime). */
        expect(lowered).toContain('$awaits.push(')
        expect(lowered).not.toMatch(/\$text\([^;]*getPromise/)
    })

    test('a sync interpolation is unchanged by the classifier', () => {
        const lowered = compileComponent(SOURCE, false, undefined, undefined, classify)
        /* Only the promise interpolation became an await — the sync `{count}` did not, so
           there is exactly one await block in the whole component. */
        expect(lowered.match(/\$\$awaitBlock\(/g)?.length).toBe(1)
        /* `{count}` still binds as a plain text value. */
        expect(lowered).toMatch(/\$\$appendText\([^;]*count/)
    })

    test('without a classifier the promise interpolation stays a plain text bind', () => {
        const plain = compileComponent(SOURCE)
        expect(plain).not.toContain('$$awaitBlock(')
        /* Today's default path: the promise binds through the plain text helper. */
        expect(plain).toContain('getPromise()')
        expect(plain).toMatch(/\$\$appendText\([^;]*getPromise/)
    })
})
