/** NSEventModifierFlags' bits, which a menu item's shortcut is set with and a status item's click read by. */
export const EVENT_MODIFIER = {
    SHIFT: 1 << 17,
    CONTROL: 1 << 18,
    OPTION: 1 << 19,
    COMMAND: 1 << 20,
} as const
