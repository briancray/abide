/**
 * How long a connection `App.listen` or `abide dev` binds may go without a byte while nothing over it
 * is being answered (16.56): a body still arriving, or a kept-alive connection between requests.
 * `Bun.serve`'s own default, named so the bound a request lifts can be put back.
 */
export const IDLE_TIMEOUT_SECONDS = 10
