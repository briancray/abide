import { expect, test } from 'bun:test'

import { menuShortcut } from '#server/menuShortcut.ts'

const COMMAND = 1 << 20
const SHIFT = 1 << 17

// 53.9 — A MENU ITEM'S KEY READS AS `hotkeys` READS IT. THE REVERT: split on `+` and drop a modifier
// it does not know, as the menu bar once did — `mod++` binds no key and `hyper+k` binds a bare `k`.
test("a MenuItem's key reads the modifiers and keys hotkeys reads — 53.9", () => {
    expect(menuShortcut('mod+shift+k')).toEqual({
        keyEquivalent: 'k',
        modifiers: COMMAND | SHIFT,
    })
    expect(menuShortcut('command+esc')).toEqual({
        keyEquivalent: '\x1b',
        modifiers: COMMAND,
    })
    expect(menuShortcut('mod++')).toEqual({
        keyEquivalent: '+',
        modifiers: COMMAND,
    })
    expect(() => menuShortcut('hyper+k')).toThrow('RULEBOOK 53.9')
})
