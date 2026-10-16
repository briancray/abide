// THE TRACE, PASSED DOWN BY HAND. Every module the request reaches takes
// it as an argument, so a helper that forgets to thread it writes a line
// nobody can select.
type Line = { trace: string; message: string }

const written: Line[] = []

function log(trace: string, message: string): void {
    written.push({ trace, message })
}

async function notifyBilling(contact: string, trace: string): Promise<void> {
    await Bun.sleep(150)
    log(trace, `billing told about contact ${contact}`)
}

Bun.serve({
    routes: {
        '/api/syncContact': async (request) => {
            const trace = crypto.randomUUID().replaceAll('-', '')
            const { id } = (await request.json()) as { id: string }
            log(trace, `contact ${id} loaded`)
            await notifyBilling(id, trace)
            const lines: string[] = []
            for (const line of written)
                if (line.trace === trace) lines.push(line.message)
            return Response.json({ trace, lines })
        },
    },
})
