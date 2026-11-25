// 53.1-53.9 — KEYBOARD SHORTCUTS AS ONE `keydown` LISTENER, parsed once when it is made. Nothing runs
// at import, so an app that never names `hotkeys` ships none of it.

import { type HotkeyBinding, hotkeyBinding } from './hotkeyBinding.ts'
import { isApplePlatform } from './isApplePlatform.ts'
import { isEditableTarget } from './isEditableTarget.ts'

/** What a binding runs on its key, alone or with whether it also runs while the visitor types. */
export type Hotkey =
    | ((event: KeyboardEvent) => void)
    | {
          /** Runs on the key, handed the `keydown` that matched. */
          run: (event: KeyboardEvent) => void
          /**
           * Whether the binding runs while the event's target is a field the visitor types in
           * (`isEditableTarget`). `false` by default: a bare `n` belongs to the field it is typed in.
           */
          editable?: boolean | undefined
          /**
           * Whether the binding calls `preventDefault` on the press it runs for. `true` by default;
           * `false` leaves the key's default to the page — an Escape a dialog still closes on.
           */
          prevent?: boolean | undefined
      }

type Bound = HotkeyBinding & {
    run: (event: KeyboardEvent) => void
    editable: boolean
    prevent: boolean
}

/**
 * A `keydown` listener running the binding a key press matches. Put it on `<window onkeydown>` for
 * the whole page, or on an element for the keys pressed inside it.
 *
 * A binding is its modifiers and then its key, joined by `+`: `'n'`, `'?'`, `'shift+n'`,
 * `'mod+k'`, `'Escape'`, `'alt+ArrowUp'`. The key is `KeyboardEvent.key`, matched case-blind, and
 * `space` names `' '`. The modifiers are `ctrl`, `meta`, `alt`, `shift`, and `mod`, which is ⌘ on an
 * Apple platform and Ctrl on any other. `keyLabel` writes a binding for a person to read.
 *
 * @param bindings each binding, to what it runs; the first that matches a press is the one that runs
 */
export function hotkeys(
    bindings: Record<string, Hotkey>,
): (event: KeyboardEvent) => void {
    const bound: Bound[] = []
    for (const [written, hotkey] of Object.entries(bindings)) {
        bound.push({
            ...hotkeyBinding(written),
            run: typeof hotkey === 'function' ? hotkey : hotkey.run,
            editable:
                typeof hotkey === 'function' ? false : hotkey.editable === true,
            prevent:
                typeof hotkey === 'function' ? true : hotkey.prevent !== false,
        })
    }
    let apple: boolean | undefined
    return (event) => {
        // 53.8 — a press an inner handler already took, or one an input method is composing.
        if (
            event.defaultPrevented ||
            event.isComposing ||
            event.keyCode === 229
        )
            return
        apple ??= isApplePlatform()
        const editing = isEditableTarget(event.target)
        for (const binding of bound) {
            if (editing && !binding.editable) continue
            if (!matches(binding, event, apple)) continue
            // 53.2.
            if (binding.prevent) event.preventDefault()
            binding.run(event)
            return
        }
    }
}

function matches(
    binding: HotkeyBinding,
    event: KeyboardEvent,
    apple: boolean,
): boolean {
    if (event.ctrlKey !== (binding.ctrl || (binding.mod && !apple)))
        return false
    if (event.metaKey !== (binding.meta || (binding.mod && apple))) return false
    if (event.altKey !== binding.alt) return false
    if (binding.shift !== undefined && event.shiftKey !== binding.shift)
        return false
    const key = event.key.toLowerCase()
    if (key === binding.key) return true
    // 53.6 — a key alt composed into another character (`alt+k` types `˚` on a Mac), or one typed on
    // a layout with no latin letters, is matched by where it sits.
    if (binding.key.length !== 1 || /^[\x20-\x7e]$/.test(event.key))
        return false
    return (
        event.code === `Key${binding.key.toUpperCase()}` ||
        event.code === `Digit${binding.key}`
    )
}
