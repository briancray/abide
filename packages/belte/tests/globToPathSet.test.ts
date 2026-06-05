import { afterAll, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { globToPathSet } from '../src/lib/server/runtime/globToPathSet.ts'

const roots: string[] = []
afterAll(() => {
    roots.forEach((root) => {
        rmSync(root, { recursive: true, force: true })
    })
})

// Creates a temp dir, runs `build` against it to lay out files, returns the dir.
function tempDir(build: (dir: string) => void): string {
    const dir = mkdtempSync(`${tmpdir()}/glob-`)
    roots.push(dir)
    build(dir)
    return dir
}

/*
Regression: `Bun.file(dir).exists()` returns false for a directory, so the
former guard left this Set empty even when the dir held files — disabling
disk-zstd asset serving. globToPathSet scans the real dir, so an existing
tree yields a populated Set.
*/
test('maps the _app .zst tree to asset request paths', async () => {
    const dir = tempDir((root) => {
        mkdirSync(`${root}/chunks`, { recursive: true })
        writeFileSync(`${root}/entry.js.zst`, 'x')
        writeFileSync(`${root}/chunks/a.css.zst`, 'x')
    })
    const paths = await globToPathSet(
        dir,
        '**/*.zst',
        (file) => `/_app/${file.replace(/\.zst$/, '')}`,
    )
    expect(paths).toEqual(new Set(['/_app/entry.js', '/_app/chunks/a.css']))
})

test('maps a public tree to root-relative paths, dotfiles included with dot:true', async () => {
    const dir = tempDir((root) => {
        mkdirSync(`${root}/.well-known`, { recursive: true })
        writeFileSync(`${root}/favicon.ico`, 'x')
        writeFileSync(`${root}/.well-known/site`, 'x')
    })
    const paths = await globToPathSet(dir, '**/*', (file) => `/${file}`, { dot: true })
    expect(paths).toEqual(new Set(['/favicon.ico', '/.well-known/site']))
})

test('excludes dotfiles by default', async () => {
    const dir = tempDir((root) => {
        writeFileSync(`${root}/visible`, 'x')
        writeFileSync(`${root}/.hidden`, 'x')
    })
    const paths = await globToPathSet(dir, '**/*', (file) => `/${file}`)
    expect(paths).toEqual(new Set(['/visible']))
})

test('a missing directory yields an empty set instead of throwing', async () => {
    const paths = await globToPathSet('/no/such/dir/xyz', '**/*', (file) => `/${file}`)
    expect(paths).toEqual(new Set())
})
