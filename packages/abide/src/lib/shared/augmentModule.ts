/*
Emits one `declare module '<module>' { interface <iface> { … } }` block, the
module-augmentation shape every codegen writer (routes, rpc, publicAssets,
testRpc, testSockets) shares. `entries` is `[key, type]` pairs already in final
order; each becomes an 8-space-indented `"key": type` member, the indentation
the consumer src tsconfig include expects. Returns the block body only — the
writeDts envelope adds banner + footer.
*/
export function augmentModule(module: string, iface: string, entries: [string, string][]): string {
    const members = entries
        .map(([key, type]) => `        ${JSON.stringify(key)}: ${type}`)
        .join('\n')
    return `declare module '${module}' {
    interface ${iface} {
${members}
    }
}`
}
