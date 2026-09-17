// What a read throws where nothing has landed. RULEBOOK 2.2.
//
// It carries the value it was thrown FOR, and that is the whole mechanism behind the
// abort: a tracked body that meets one subscribes to `source` and re-runs when it
// lands, so the body never computes against an absent value and never takes the wrong
// branch. The privileged-call hazard is what that buys — a body run to completion
// against an unlanded read issues the else arm's call for a caller nothing has
// authenticated.
//
// A refusal is a DIFFERENT throw and must not be caught by the same arm: this one is
// "not yet", a `Failed` is "no". Two brands, two catchers.
export class NotLanded extends Error {
    readonly source: object

    constructor(source: object, name: string) {
        super(`${name} has not landed`)
        this.name = 'NotLanded'
        this.source = source
    }
}
