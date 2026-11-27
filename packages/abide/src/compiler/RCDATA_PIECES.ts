/**
 * 35.9 — the expressions a `<textarea>` or a `<title>` holds as its own text, which the parser reads
 * as RCDATA: never markup, so their run is text on both sides and holds no `Raw` anchor (32.30).
 * Filed by `parseAbide`, read by `Lowering.holdsMarkup` and the server's text run.
 */
export const RCDATA_PIECES = new WeakSet<object>()
