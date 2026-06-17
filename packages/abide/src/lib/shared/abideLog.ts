import { createChannelLog } from './createChannelLog.ts'
import { emitLogRecord } from './emitLogRecord.ts'
import type { ChannelLog } from './types/ChannelLog.ts'
import type { FrameworkLog } from './types/FrameworkLog.ts'

const ABIDE_CHANNEL = 'abide'

/*
The framework's own voice: the public log shape bound to the always-on
'abide' channel, so every framework line — boot messages, build output,
internal warns/errors, the closing record's sibling diagnostics — reads
`[abide] …` and json consumers filter channel='abide'. The styling voices
(info/success/detail) ride the same channel and the same negation gate, so
DEBUG=-abide silences every voice; diagnostic sub-channels (abide:cache,
abide:rpc, …) stay DEBUG-gated via .channel().
*/
const channelVoice = createChannelLog(() => ABIDE_CHANNEL, true)

export const abideLog: FrameworkLog = Object.assign(channelVoice, {
    channel(name: string): ChannelLog {
        return createChannelLog(() => name, false)
    },
    info(message: string): void {
        if (channelVoice.enabled()) {
            emitLogRecord({ level: 'info', msg: message, channel: ABIDE_CHANNEL })
        }
    },
    success(message: string): void {
        if (channelVoice.enabled()) {
            emitLogRecord({ level: 'info', msg: message, channel: ABIDE_CHANNEL }, 'success')
        }
    },
    detail(message: string): void {
        if (channelVoice.enabled()) {
            emitLogRecord({ level: 'info', msg: message, channel: ABIDE_CHANNEL }, 'detail')
        }
    },
})
