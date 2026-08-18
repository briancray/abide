// The one endpoint this app has, and it is shaped to make the two argument claims DISTINGUISHABLE.
//
// `--times=2` on a declared number and `--name=42` on a declared string are the pair: a console that
// parsed flags by looking at them gets the first right by luck and the second wrong, because `42` is
// what JSON says that text is and the declaration is what says it is a name.
import { GET } from 'abide/server'

export const greet = GET(({ name, times }: { name: string; times: number }) => ({
    said: `${'hi '.repeat(times).trim()} ${name}`,
    // The types, because the strings would read the same either way: `'hi '.repeat('2')` is `hi hi`
    // in JavaScript too, and only this says which value crossed the wire.
    numeric: typeof times === 'number',
    named: typeof name === 'string',
}))
