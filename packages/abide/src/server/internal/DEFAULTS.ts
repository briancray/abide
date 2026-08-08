// The one default that is named in two places, and so has to be named in neither of them.
//
// `FLOOR` in `config.ts` publishes it, and `abide logs` looks for a local app on it — two files that
// must agree about 3000, and neither of them may import the other: the CLI reaching for `config.ts`
// would drag the schema gate into a command whose whole job is to read a stream. A leaf with no
// imports is what lets both sides ask.
//
// The rest of abide's floors are NOT here. Each of those has exactly one reader — `FLOOR` — and a
// number given a name it is written under once is a second place to look rather than a shared fact.

/** `PORT` — what an app binds, and the port `abide logs` looks for one on. */
export const DEFAULT_PORT = 3000
