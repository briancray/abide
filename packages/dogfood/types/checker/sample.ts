export interface Full {
    id: number
    name: string
    secret: string
    tag?: string
}
export enum Role {
    admin = 'admin',
    user = 'user',
}
export type Box<T> = { value: T; count: number }
export type Create = Omit<Full, 'id'>
export type Just = Pick<Full, 'id' | 'name'>
export type Needed = Required<Pick<Full, 'tag'>>
export interface Args {
    create: Create
    just: Just
    role: Role
    boxed: Box<string>
    needed: Needed
}
