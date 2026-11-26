import { refuse, rpc } from '@abide/abide/server'

export default rpc(() => refuse(502, 'The mailer refused the statement'), {
    methods: ['POST'],
})
