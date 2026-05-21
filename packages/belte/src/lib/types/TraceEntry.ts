export type TraceEntry = {
    kind: 'resolve' | 'fetch' | 'module' | 'api'
    label: string
    ms: number
}
