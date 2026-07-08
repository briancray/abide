import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { classifyInterpolationType } from '../src/lib/ui/compile/classifyInterpolationType.ts'
import { createShadowProgram } from '../src/lib/ui/compile/createShadowProgram.ts'
import { nodeAtShadowOffset } from '../src/lib/ui/compile/nodeAtShadowOffset.ts'
import { parseTemplate } from '../src/lib/ui/compile/parseTemplate.ts'
import { sourceToShadowOffset } from '../src/lib/ui/compile/sourceToShadowOffset.ts'
import type { InterpolationKind } from '../src/lib/ui/compile/types/InterpolationKind.ts'
import type { TemplateNode } from '../src/lib/ui/compile/types/TemplateNode.ts'

/* A throwaway project on disk — createShadowProgram reads sources via ts.sys, so
   the component and its tsconfig must live as real files for the checker to run. */
const SOURCE = `<script>
async function getUser(): Promise<{ id: number }> { return { id: 1 } }
async function* getStream(): AsyncIterable<string> { yield 'a' }
function makeNameless() {
    return { [Symbol.asyncIterator]() { return { next: async () => ({ done: true, value: undefined }) } } }
}
const count: number = 5
function getMaybe(): Promise<number> | undefined { return undefined }
function getUnionStream(): AsyncIterable<number> | undefined { return undefined }
</script>
<div>{getUser()}</div>
<div>{getStream()}</div>
<div>{makeNameless()}</div>
<div>{count}</div>
<div>{getMaybe()}</div>
<div>{getUnionStream()}</div>
`

const EXPECTED: Record<string, InterpolationKind> = {
    'getUser()': 'promise',
    'getStream()': 'asyncIterable',
    'makeNameless()': 'asyncIterable',
    count: 'sync',
    'getMaybe()': 'promise',
    'getUnionStream()': 'asyncIterable',
}

describe('classifyInterpolationType', () => {
    const dir = mkdtempSync(join(tmpdir(), 'abide-classify-'))
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

    const { program, shadows } = createShadowProgram(dir, [abidePath])
    const checker = program.getTypeChecker()
    const shadow = shadows.get(abidePath)!
    const shadowFile = program.getSourceFile(`${abidePath}.ts`)!

    /* Collect each template interpolation's code + its source offset. */
    const templateStart = SOURCE.indexOf('</script>') + '</script>'.length
    const { nodes } = parseTemplate(SOURCE.slice(templateStart), templateStart)
    const interpolations: { code: string; loc: number }[] = []
    const walk = (list: TemplateNode[]): void => {
        for (const node of list) {
            if (node.kind === 'text') {
                for (const part of node.parts) {
                    if (part.kind === 'expression' && part.loc !== undefined) {
                        interpolations.push({ code: part.code, loc: part.loc })
                    }
                }
            }
            if ('children' in node) {
                walk(node.children)
            }
        }
    }
    walk(nodes)

    const classifyOf = (code: string): InterpolationKind => {
        const interpolation = interpolations.find((entry) => entry.code === code)!
        const shadowOffset = sourceToShadowOffset(shadow.mappings, interpolation.loc)!
        const node = nodeAtShadowOffset(shadowFile, shadowOffset, interpolation.code.length)!
        return classifyInterpolationType(checker.getTypeAtLocation(node), node, checker)
    }

    test('a Promise<T> call classifies as promise', () => {
        expect(classifyOf('getUser()')).toBe('promise')
    })

    test('an AsyncIterable<T> call classifies as asyncIterable', () => {
        expect(classifyOf('getStream()')).toBe('asyncIterable')
    })

    test('a nameless async iterable classifies as asyncIterable', () => {
        expect(classifyOf('makeNameless()')).toBe('asyncIterable')
    })

    test('a sync number identifier classifies as sync', () => {
        expect(classifyOf('count')).toBe('sync')
    })

    test('a Promise<T> | undefined union classifies as promise', () => {
        expect(classifyOf('getMaybe()')).toBe('promise')
    })

    test('an AsyncIterable<T> | undefined union classifies as asyncIterable', () => {
        expect(classifyOf('getUnionStream()')).toBe('asyncIterable')
    })

    test('all six spike cases classify as expected', () => {
        for (const [code, expected] of Object.entries(EXPECTED)) {
            expect(classifyOf(code)).toBe(expected)
        }
    })
})
