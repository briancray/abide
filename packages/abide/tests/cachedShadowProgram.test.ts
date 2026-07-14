import { describe, expect, spyOn, test } from 'bun:test'
import { cachedShadowProgram } from '../src/lib/ui/compile/cachedShadowProgram.ts'
import type { ShadowProgram } from '../src/lib/ui/compile/createShadowProgram.ts'

/* `cachedShadowProgram` builds the warm shadow program once per root and caches it. A build
   failure must degrade to `undefined` (the classifiers fall back to today's behavior) WITHOUT
   breaking the build — but it must WARN, once, so async detection isn't silently disabled for a
   whole project. The `build` param stands in for `createShadowProgram` so the failure is
   deterministic. */
describe('cachedShadowProgram', () => {
    const fakeProgram = { program: {}, shadows: new Map() } as unknown as ShadowProgram

    test('a successful build is returned and cached (built once per root)', () => {
        const cache = new Map<string, ShadowProgram | undefined>()
        let builds = 0
        const build = () => {
            builds++
            return fakeProgram
        }
        expect(cachedShadowProgram(cache, '/root', build)).toBe(fakeProgram)
        expect(cachedShadowProgram(cache, '/root', build)).toBe(fakeProgram)
        expect(builds).toBe(1) // cache hit — not rebuilt
    })

    test('a build failure warns once, caches undefined, and never breaks', () => {
        const cache = new Map<string, ShadowProgram | undefined>()
        const warn = spyOn(console, 'warn').mockImplementation(() => {})
        try {
            const build = () => {
                throw new Error('bad tsconfig')
            }
            // degrades to undefined rather than throwing
            expect(cachedShadowProgram(cache, '/root', build)).toBeUndefined()
            // a second request for the same root reuses the cached failure — no second warn
            expect(cachedShadowProgram(cache, '/root', build)).toBeUndefined()
            expect(warn).toHaveBeenCalledTimes(1)
            const message = warn.mock.calls[0]?.[0] as string
            expect(message).toContain('/root')
            expect(message).toContain('bad tsconfig')
        } finally {
            warn.mockRestore()
        }
    })

    test('a distinct root warns separately', () => {
        const cache = new Map<string, ShadowProgram | undefined>()
        const warn = spyOn(console, 'warn').mockImplementation(() => {})
        try {
            const build = () => {
                throw new Error('boom')
            }
            cachedShadowProgram(cache, '/a', build)
            cachedShadowProgram(cache, '/b', build)
            expect(warn).toHaveBeenCalledTimes(2)
        } finally {
            warn.mockRestore()
        }
    })
})
