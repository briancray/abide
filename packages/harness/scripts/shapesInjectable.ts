// WHICH CALLABLE SHAPE, IN THIS ENGINE. The bytes answer was taken under JSC and the
// ranking need not survive the crossing: a function carrying ~34 own properties is a
// dictionary-mode candidate in V8 and is merely large in JSC, so the shape that wins on
// retained bytes may lose on every property access.
import { batch, type Sample } from 'harness/report'

type Any = Record<string, unknown> & (() => unknown)

const MEMBERS: Record<string, unknown> = {}
for (const name of [
    'peek',
    'busy',
    'ready',
    'error',
    'set',
    'publish',
    'patch',
    'refresh',
    'invalidate',
    'watch',
    'then',
    'catch',
    'finally',
])
    MEMBERS[name] = function member(this: Any): unknown {
        return this.value
    }

function fill(target: Record<string, unknown>): Record<string, unknown> {
    target.readers = []
    target.sources = []
    target.cursor = 0
    target.diverged = false
    target.label = 'r'
    target.body = null
    target.args = undefined
    target.value = 0
    target.landed = true
    target.stale = false
    target.servable = true
    target.loading = false
    target.failure = undefined
    target.transform = null
    target.tailDepth = 0
    target.ring = []
    target.version = 0
    target.snapshot = null
    target.snapshotVersion = -1
    target.ordinal = 0
    target.generation = 0
    target.alive = true
    target.changedAt = 0
    target.checkedAt = 0
    target.state = 0
    target.isEffect = false
    return target
}

/** OWN PROPERTIES: members and state both assigned onto the function, which reads its closure. */
function ownProperties(): Any {
    const self = function read(): unknown {
        return (self as unknown as Any).value
    } as unknown as Any
    fill(self as unknown as Record<string, unknown>)
    Object.assign(self, MEMBERS)
    Object.defineProperty(self, Symbol.for('b'), { value: true })
    return self
}

const PROTO = Object.assign(Object.create(Function.prototype), MEMBERS, {
    b: true,
})
/** PROTOTYPE: members on one pointer, state still own, function names itself. */
function proto(): Any {
    const self = function read(): unknown {
        return (read as unknown as Any).value
    } as unknown as Any
    Object.setPrototypeOf(self, PROTO)
    fill(self as unknown as Record<string, unknown>)
    return self
}

const PROTO_RECORD = Object.assign(Object.create(Function.prototype), {
    peek(this: Any): unknown {
        return (this.c as Any).value
    },
    set(this: Any, v: unknown): void {
        ;(this.c as Any).value = v
    },
    b: true,
})
/**
 * RECORD: ONE own property on the function, every field on a plain object.
 *
 * The shape `Reactive.ts` ships: a callable seated on a member prototype, holding its state on the
 * record under `CELL`.
 */
function record(): Any {
    const self = function read(): unknown {
        return ((read as unknown as Any).c as Any).value
    } as unknown as Any
    Object.setPrototypeOf(self, PROTO_RECORD)
    self.c = fill({})
    return self
}

function rows(): { shape: string; read: number; write: number }[] {
    const out: { shape: string; read: number; write: number }[] = []
    const shapes: [string, () => Any][] = [
        ['own props', ownProperties],
        ['prototype', proto],
        ['record', record],
    ]
    const made = shapes.map(([name, make]) => [name, make()] as const)
    let sink: unknown
    const readArms: Record<string, () => void> = {}
    const writeArms: Record<string, () => void> = {}
    for (const [name, value] of made) {
        readArms[name] = (): void => {
            sink = value()
        }
        writeArms[name] = (): void => {
            ;(value as unknown as { set(v: unknown): void }).set(1)
        }
    }
    const read = batch({
        case: 'read',
        arms: readArms,
        emulated: null,
        budgetNanoseconds: 20_000_000_000,
    })
    const write = batch({
        case: 'write',
        arms: writeArms,
        emulated: null,
        budgetNanoseconds: 20_000_000_000,
    })
    for (const [name] of made)
        out.push({
            shape: name,
            read: (read.samples[name] as Sample).nanoseconds,
            write: (write.samples[name] as Sample).nanoseconds,
        })
    if (sink === Symbol.iterator) throw new Error('unreachable')
    return out
}

;(globalThis as unknown as { __SHAPES__: () => unknown }).__SHAPES__ = rows
