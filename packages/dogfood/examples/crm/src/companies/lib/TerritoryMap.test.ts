import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import TerritoryMap from './TerritoryMap.abide'

const surface = () =>
    document.querySelector('[data-pan-zoom=surface]') as HTMLElement
const moved = () => document.querySelector('svg')?.getAttribute('style')
const key = (name: string) => {
    surface().dispatchEvent(
        new KeyboardEvent('keydown', { key: name, cancelable: true }),
    )
    flushSync()
}

test('the territories pan and zoom from the keys, and frame a region', async () => {
    using _map = await mount(TerritoryMap({}))
    // The emulator lays nothing out: the surface stands 400 by 192.
    surface().getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 400, height: 192 }) as DOMRect
    key('ArrowLeft')
    expect(moved()).toBe(
        'transform:translate(40px,0px) scale(1);transform-origin:0 0',
    )
    key('0')
    key('-')
    expect(moved()).toBe(
        'transform:translate(40px,19.2px) scale(0.8);transform-origin:0 0',
    )
    ;(document.querySelector('button') as HTMLButtonElement).click()
    flushSync()
    // 168 tall clear of 12px each side: 1.12 the height of the south, which is the tighter.
    expect(moved()).toContain('scale(1.12)')
})
