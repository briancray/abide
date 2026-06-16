/* A writable reactive cell. Reading `.value` subscribes the running observer;
   assigning it notifies subscribers (an `Object.is`-equal write is a no-op). */
export type State<T> = { value: T }
