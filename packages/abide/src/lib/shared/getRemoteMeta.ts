import { remoteMetaStore } from './remoteMetaStore.ts'

export function getRemoteMeta(promise: Promise<unknown>): Request | undefined {
    return remoteMetaStore.get(promise)?.()
}
