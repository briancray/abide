/**
 * A refusal that knows WHERE in the file's text it stands, so a sink handed the text reports it on
 * the line and column the author typed rather than at the file (`Refusals.at`).
 */
export class PositionedRefusal extends Error {
    /** The offset into the file's text the refusal stands at. */
    readonly offset: number

    constructor(message: string, offset: number) {
        super(message)
        this.offset = offset
    }
}
