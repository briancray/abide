// The `channel` ladder. Each rung is the one above it plus the one thing `adds` names.
import type { Example } from 'harness'
import One from './1-publish-and-read.abide'
import ONE from './1-publish-and-read.abide?source'
import Two from './2-remember-the-last-few.abide'
import TWO from './2-remember-the-last-few.abide?source'

export const LADDER: Example[] = [
    { adds: 'publish, and read the latest — the read IS the subscription', of: ['channel'], source: ONE, view: One },
    { adds: 'remember the last few, with `tail`', of: ['channel'], source: TWO, view: Two },
]
