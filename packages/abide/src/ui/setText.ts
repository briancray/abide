// What a slot's binding writes. The COMPARE is the point: a write to `data` that does not change
// it still invalidates layout, and a slot re-run by a value that landed on the same string is the
// common case rather than the rare one.
export function setText(node: Text, value: unknown): void {
    const next = value == null ? '' : String(value)
    if (node.data !== next) node.data = next
}
