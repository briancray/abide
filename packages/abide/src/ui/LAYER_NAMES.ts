// THE NAMES A LAYER IS MEASURED UNDER, and the whole reason they are a leaf: they cross from the
// code that EMITS the measure to the spec that reads it, and a string typed twice is a
// `shares()` call that throws "found no measure named" against a layer that ran.
//
// `.` RATHER THAN `:`. `abide:hydrate` and `abide:navigate` are WARNING channels (28.8) and these
// are performance entries — two namespaces that would otherwise be one grep.
//
// ONE NAME PER OP SOMEBODY WAITS ON, never per row. `shares()` sums every measure of a layer
// inside the op, so a mark per row would cost a `performance.mark` per row to report the same
// fraction, and CLAUDE.md's hot-path rules apply to the instrument as much as to the code.
export const LAYER_NAVIGATE = 'abide.navigate'
export const LAYER_MOUNT = 'abide.mount'
export const LAYER_RECONCILE = 'abide.reconcile'
// EVERY REGION THE BROWSER FILLS PARSES A STRING — an `{#if}` arm, a navigated-to page building
// itself (30.11), a component filling its own region (32.18). Emitted only where a fill actually
// PARSES: `fillRegion` early-returns on the empty markup that merely empties a region, so the run
// count of this layer is the number of parses a navigation really performed rather than the number
// of call sites the build emitted.
export const LAYER_FILL = 'abide.fill'
