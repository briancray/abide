// 18.26 — WHERE A PATCH'S WRITES ARE KEPT AS DATA, by the cell they were made to. Only a value the
// server follows over the mux has one, so every other patch records nothing but its marks (32.34).
// `lost` where a write could not be kept as data, and then the change is sent as the value (18.28).
// `fed` is how many followers the server is feeding it, and the sink goes with the last.
// A leaf, because the reactive core writes it and the server reads it.
export type PatchOp =
    | { path: (string | number)[]; set: unknown }
    | { path: (string | number)[]; delete: true }
    | { path: (string | number)[]; call: string; args: unknown[] }

export const PATCH_SINKS = new WeakMap<
    object,
    { ops: PatchOp[]; lost: boolean; fed: number }
>()
