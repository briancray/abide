import { appNameSlot } from './appNameSlot.ts'

export function setAppName(name: string | undefined): void {
    appNameSlot.name = name
}
