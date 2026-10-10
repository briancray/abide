/**
 * One JSON Patch operation (RFC 6902), its `path` and `from` JSON Pointers (RFC 6901).
 *
 * A patch abide records is `add`, `remove` and `replace` alone; `move`, `copy` and `test` are
 * applied where a client sends them.
 */
export type PatchOp =
    | { op: 'add'; path: string; value: unknown }
    | { op: 'remove'; path: string }
    | { op: 'replace'; path: string; value: unknown }
    | { op: 'move'; from: string; path: string }
    | { op: 'copy'; from: string; path: string }
    | { op: 'test'; path: string; value: unknown }

/**
 * Where a patch's writes are kept as data, by the cell they were made to.
 *
 * 18.11. Only a value the server follows over the mux has one, so every other patch records
 * nothing but its marks (32.33). `lost` where a write could not be kept as data, and then the
 * change is sent as the value (18.13). `fed` is how many followers the server is feeding it, and
 * the sink goes with the last. A leaf, because the reactive core writes it and the server reads it.
 */
export const PATCH_SINKS = new WeakMap<
    object,
    { ops: PatchOp[]; lost: boolean; fed: number }
>()
