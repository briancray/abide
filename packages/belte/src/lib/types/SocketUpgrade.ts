export type SocketUpgrade<T> = (req: Request) => false | { data: T } | Promise<false | { data: T }>
