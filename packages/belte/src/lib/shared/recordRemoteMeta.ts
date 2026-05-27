import { remoteMetaStore } from './remoteMetaStore.ts'

export function recordRemoteMeta(promise: Promise<unknown>, getRequest: () => Request): void {
    remoteMetaStore.set(promise, getRequest)
}
