import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkAbide } from '../src/checkAbide.ts'
import { collectAbideDiagnostics } from '../src/lib/ui/compile/collectAbideDiagnostics.ts'
import { createShadowProgram } from '../src/lib/ui/compile/createShadowProgram.ts'
import { nearestProjectRoot } from '../src/lib/ui/compile/nearestProjectRoot.ts'

/* A strict tsconfig, optionally with extra compiler options (e.g. `paths`). */
const tsconfig = (extra: object = {}): string =>
    JSON.stringify({
        compilerOptions: {
            strict: true,
            module: 'esnext',
            moduleResolution: 'bundler',
            target: 'esnext',
            ...extra,
        },
    })

describe('asset module imports', () => {
    test('a stylesheet side-effect import resolves without a module error', () => {
        const dir = mkdtempSync(join(tmpdir(), 'abide-asset-'))
        writeFileSync(join(dir, 'tsconfig.json'), tsconfig())
        writeFileSync(
            join(dir, 'Styled.abide'),
            `<script>\nimport './app.css'\nconst { title } = props<{ title: string }>()\n</script>\n<h1>{title}</h1>\n`,
        )
        expect(collectAbideDiagnostics(createShadowProgram(dir))).toHaveLength(0)
    })
})

describe('aliased imports', () => {
    test('a path-aliased component import resolves to its shadow', () => {
        const dir = mkdtempSync(join(tmpdir(), 'abide-alias-'))
        mkdirSync(join(dir, 'src/ui'), { recursive: true })
        writeFileSync(
            join(dir, 'tsconfig.json'),
            tsconfig({ baseUrl: '.', paths: { '$ui/*': ['./src/ui/*'] } }),
        )
        writeFileSync(
            join(dir, 'src/ui/Child.abide'),
            `<script>\nconst { label } = props<{ label: string }>()\n</script>\n<span>{label}</span>\n`,
        )
        writeFileSync(
            join(dir, 'src/ui/Parent.abide'),
            `<script>\nimport Child from '$ui/Child.abide'\n</script>\n<Child label="hi" />\n`,
        )
        const moduleErrors = collectAbideDiagnostics(createShadowProgram(dir)).filter(
            (diagnostic) => diagnostic.message.includes('Cannot find module'),
        )
        expect(moduleErrors).toHaveLength(0)
    })
})

describe('nearestProjectRoot', () => {
    test('returns the directory of the nearest tsconfig above a file', () => {
        const root = mkdtempSync(join(tmpdir(), 'abide-root-'))
        mkdirSync(join(root, 'pkg/src'), { recursive: true })
        writeFileSync(join(root, 'tsconfig.json'), '{}')
        writeFileSync(join(root, 'pkg/tsconfig.json'), '{}')
        expect(nearestProjectRoot(join(root, 'pkg/src/X.abide'), root)).toBe(join(root, 'pkg'))
        expect(nearestProjectRoot(join(root, 'Y.abide'), root)).toBe(root)
    })
})

describe('checkAbide groups by project', () => {
    test('a component checks against its own project tsconfig, not the root', async () => {
        const root = mkdtempSync(join(tmpdir(), 'abide-mono-'))
        /* Root project: no `$ui` alias. */
        writeFileSync(join(root, 'tsconfig.json'), tsconfig())
        /* Sub-project that defines `$ui` — the alias only resolves under its tsconfig. */
        mkdirSync(join(root, 'app/src/ui'), { recursive: true })
        writeFileSync(
            join(root, 'app/tsconfig.json'),
            tsconfig({ baseUrl: '.', paths: { '$ui/*': ['./src/ui/*'] } }),
        )
        writeFileSync(
            join(root, 'app/src/ui/Child.abide'),
            `<script>\nconst { label } = props<{ label: string }>()\n</script>\n<span>{label}</span>\n`,
        )
        writeFileSync(
            join(root, 'app/src/ui/Parent.abide'),
            `<script>\nimport Child from '$ui/Child.abide'\n</script>\n<Child label="hi" />\n`,
        )
        /* Against the root tsconfig (no grouping) the alias is unresolvable — proves
           the dependency is real and project-local. */
        const rootProgram = collectAbideDiagnostics(createShadowProgram(root))
        expect(
            rootProgram.some((diagnostic) => diagnostic.message.includes('$ui/Child.abide')),
        ).toBe(true)
        /* Grouping each component under its own tsconfig resolves the alias → clean. */
        expect(await checkAbide({ cwd: root })).toBe(0)
    })
})
