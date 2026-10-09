const pasted = document.querySelector('#pasted')
const list = document.querySelector('#issues')

const PLANS = ['starter', 'team', 'enterprise']

// THE SHAPE, WRITTEN AS CODE. Each rule is a branch and each message is
// a string here, so the document an API publishes and the check this
// page runs are two things that only agree while someone keeps them so.
function issuesOf(row) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
        const was =
            row === null ? 'null' : Array.isArray(row) ? 'array' : typeof row
        return { '': [`must be object, was ${was}`] }
    }
    const issues = {}
    for (const key of ['name', 'plan', 'seats'])
        if (!(key in row)) issues[key] = ['is required']
    if ('name' in row && (typeof row.name !== 'string' || row.name === ''))
        issues.name = ['must be at least 1 characters']
    if ('plan' in row && !PLANS.includes(row.plan))
        issues.plan = [
            `must be one of ${PLANS.map((one) => `"${one}"`).join(', ')}`,
        ]
    if ('seats' in row) {
        if (!Number.isInteger(row.seats)) issues.seats = ['must be integer']
        else if (row.seats < 1) issues.seats = ['must be at least 1']
        else if (row.seats > 50) issues.seats = ['must be at most 50']
    }
    return Object.keys(issues).length === 0 ? null : issues
}

function parse(text) {
    try {
        return JSON.parse(text)
    } catch {
        return text
    }
}

function field(label, value) {
    const item = document.createElement('li')
    const name = document.createElement('span')
    const said = document.createElement('strong')
    name.textContent = label
    said.textContent = value
    item.append(name, said)
    return item
}

function render() {
    const issues = issuesOf(parse(pasted.value))
    list.replaceChildren()
    if (issues === null) {
        list.append(field('import', 'ready'))
        return
    }
    for (const [path, messages] of Object.entries(issues))
        list.append(field(path || 'the row', messages[0]))
}

pasted.addEventListener('input', render)
render()
