import { afterAll, expect, test } from 'bun:test'

import { bindPart } from './bindPart.ts'

// A module instance of its own: another file's pages, bound in the same process, keep the shared
// viewport observer of the instance they imported.
const { elementVisible } = (await import(
    `${import.meta.dir}/../src/shared/element/elementVisible.ts?alone`
)) as typeof import('#shared/element/elementVisible.ts')

const real = globalThis.IntersectionObserver
afterAll(() => {
    globalThis.IntersectionObserver = real
})

// THE REVERT: keep the viewport's observer once made (`observer ??= …`, never disconnected), as
// `visible` once did — this reports `made 1, disconnected 0`.
test("the viewport's shared observer is dropped with its last element, and the next bind makes one — 32.98", () => {
    const counts = { made: 0, disconnected: 0 }
    globalThis.IntersectionObserver = class {
        constructor() {
            counts.made += 1
        }
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {
            counts.disconnected += 1
        }
    } as unknown as typeof IntersectionObserver
    const seen = (_visible: boolean) => {}
    const first = bindPart(elementVisible(seen), document.createElement('div'))
    const second = bindPart(elementVisible(seen), document.createElement('div'))
    first()
    second()
    bindPart(elementVisible(seen), document.createElement('div'))()
    expect(`made ${counts.made}, disconnected ${counts.disconnected}`).toBe(
        'made 2, disconnected 2',
    )
})
