import { remoteMetaStore } from './remoteMetaStore.ts'

export function recordRemoteMeta(promise: Promise<unknown>, request: Request): void {
    remoteMetaStore.set(promise, request)
}
