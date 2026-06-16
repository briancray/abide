/*
Typed transport-loss signal: the multiplexed ws channel went down and tore this
subscription with it. Distinct from an application error (a server `err` frame)
because it is recoverable — tail() catches this type to reconnect with the
last value retained (refreshing), while raw `for await` consumers surface it
like any other error and keep manual control over reconciliation.
*/
export class SocketDisconnectedError extends Error {
    constructor() {
        super('socket channel disconnected')
        this.name = 'SocketDisconnectedError'
    }
}
