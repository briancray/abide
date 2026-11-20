import { afterAll, expect, test } from 'bun:test'

// A module instance of its own: another file's pages, bound in the same process, keep the shared
// viewport observer of the instance they imported.
const { visible } = (await import(
    `${import.meta.dir}/../src/shared/observe/visible.ts?alone`
)) as typeof import('#shared/observe/visible.ts')

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
    const first = visible(seen)(document.createElement('div'))
    const second = visible(seen)(document.createElement('div'))
    first()
    second()
    visible(seen)(document.createElement('div'))()
    expect(`made ${counts.made}, disconnected ${counts.disconnected}`).toBe(
        'made 2, disconnected 2',
    )
})
