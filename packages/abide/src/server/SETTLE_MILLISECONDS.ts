// How long to wait for the tree to stop moving before rebuilding. A save from an editor is more
// than one event — a write, a rename, an attribute change — and one rebuild per event is several
// rebuilds for one keystroke.
export const SETTLE_MILLISECONDS = 25
