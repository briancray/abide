// Where a build leaves what the checker derived, and where the plugin looks for it.
//
// Its own module for the reason `PRELOAD_FILE.ts` beside it is: the path crosses to the checker
// driver and to the plugin, and asking `index.ts` for it is an edge onto the whole emitter — 2,765
// lines of it — for one relative path.

/** Relative to the working directory, so it is one path to ignore and one to point a build at. */
export const SHAPES_FILE = '.abide/shapes.json'
