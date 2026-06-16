import type { SocketSubCallbacks } from './SocketSubCallbacks.ts'

/* The multiplexed-ws abstraction a Socket<T> drives: open/close a per-sub
   subscription and publish to a topic. The browser singleton (socketChannel)
   and the test harness (createTestSocketChannel) each implement it;
   buildSocketOverChannel turns either into Socket<T> objects, so the two
   surfaces can't drift on the Socket contract. */
export type SocketChannel = {
    subscribe(
        sub: string,
        socket: string,
        replay: number | undefined,
        callbacks: SocketSubCallbacks,
    ): void
    unsubscribe(sub: string): void
    publish(socket: string, message: unknown): void
}
