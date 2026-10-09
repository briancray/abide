// An export worker that has stopped answering.

export const errorReportDatabase = {
    contacts: {
        async export(): Promise<string> {
            await Bun.sleep(300)
            throw new Error('the export worker reset the connection')
        },
    },
}
