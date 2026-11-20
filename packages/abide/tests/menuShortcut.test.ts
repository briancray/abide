import { expect, test } from 'bun:test'

import { EVENT_MODIFIER } from '#server/EVENT_MODIFIER.ts'
import { menuShortcut } from '#server/menuShortcut.ts'

const { COMMAND, SHIFT } = EVENT_MODIFIER

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

// 38.213 — AN ARROW IS SPELLED AS A PAGE MATCHES IT, so one `key` works in the menu bar and in the
// page. THE REVERT: key the arrows as `up` and the rest — `cmd+arrowup` fills the menu bar with the
// literal `arrowup`.
test("a MenuItem's arrow keys are spelled as hotkeys and keyLabel spell them — 38.213", () => {
    expect(menuShortcut('cmd+arrowup')).toEqual({
        keyEquivalent: '\uf700',
        modifiers: COMMAND,
    })
})
