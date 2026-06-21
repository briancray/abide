import { beforeAll, describe, expect, test } from 'bun:test'
import { awaitBlock } from '../src/lib/ui/dom/awaitBlock.ts'
import { each } from '../src/lib/ui/dom/each.ts'
import { eachAsync } from '../src/lib/ui/dom/eachAsync.ts'
import { switchBlock } from '../src/lib/ui/dom/switchBlock.ts'
import { tryBlock } from '../src/lib/ui/dom/tryBlock.ts'
import { when } from '../src/lib/ui/dom/when.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { scope } from '../src/lib/ui/runtime/scope.ts'
import { state } from '../src/lib/ui/state.ts'
import { installMiniDom } from './support/installMiniDom.ts'

beforeAll(() => {
    installMiniDom()
})

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/* A control-flow block's currently-mounted content must tear down when the OWNING
   scope disposes (an SPA navigation), not only when the block itself swaps branches.
   Each probe mounts a branch holding an effect, disposes the owner, then pokes the
   effect's source: a live count past 1 means the branch effect outlived its owner —
   the leak. `probe(build)` returns a poke()/count() pair sharing one signal+owner. */
function probe(build: (host: Element, branch: () => void, signal: { value: number }) => void) {
    const host = document.createElement('div')
    const signal = state(0)
    let runs = 0
    const branch = (): void => {
        effect(() => {
            signal.value // subscribe
            runs += 1
        })
    }
    const disposeOwner = scope(() => build(host, branch, signal))
    return {
        runs: () => runs,
        teardownThenPoke: (): void => {
            disposeOwner()
            signal.value = signal.value + 1
        },
    }
}

describe('control-flow blocks dispose mounted content with their owner', () => {
    test('when', () => {
        const p = probe((host, branch) =>
            when(
                host,
                () => true,
                () => branch(),
            ),
        )
        expect(p.runs()).toBe(1)
        p.teardownThenPoke()
        expect(p.runs()).toBe(1)
    })

    test('switch', () => {
        const p = probe((host, branch) =>
            switchBlock(host, () => 'a', [{ match: () => 'a', render: () => branch() }]),
        )
        expect(p.runs()).toBe(1)
        p.teardownThenPoke()
        expect(p.runs()).toBe(1)
    })

    test('try (success path)', () => {
        const p = probe((host, branch) => tryBlock(host, 1, () => branch()))
        expect(p.runs()).toBe(1)
        p.teardownThenPoke()
        expect(p.runs()).toBe(1)
    })

    test('each', () => {
        const p = probe((host, branch) =>
            each(
                host,
                () => [1],
                (n) => String(n),
                () => branch(),
            ),
        )
        expect(p.runs()).toBe(1)
        p.teardownThenPoke()
        expect(p.runs()).toBe(1)
    })

    test('await (resolved branch)', async () => {
        const resolved = Promise.resolve('value')
        const p = probe((host, branch) =>
            awaitBlock(
                host,
                1,
                () => resolved,
                undefined,
                () => branch(),
                undefined,
            ),
        )
        await flush()
        expect(p.runs()).toBe(1)
        p.teardownThenPoke()
        expect(p.runs()).toBe(1)
    })

    test('eachAsync (streamed row)', async () => {
        async function* one(): AsyncGenerator<number> {
            yield 1
        }
        const p = probe((host, branch) =>
            eachAsync(
                host,
                () => one(),
                (n) => String(n),
                () => branch(),
                undefined,
            ),
        )
        await flush()
        expect(p.runs()).toBe(1)
        p.teardownThenPoke()
        expect(p.runs()).toBe(1)
    })
})
