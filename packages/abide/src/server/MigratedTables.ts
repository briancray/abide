// 47.47-47.49 — A DATABASE'S TABLES, TYPED FROM ITS MIGRATIONS. The SQL a migration list writes is the
// one place a table's columns are declared, so the checker reads it the way SQLite does: every
// `CREATE TABLE`, `ALTER TABLE` and `DROP TABLE` folded in order into the tables they leave, each
// column typed by its declared type's affinity and its `NOT NULL`. Nothing is generated and nothing is
// written beside the source — what a component's props are to its callers, a row is to the migration
// that declares its table.
//
// WHAT IS NOT READ is typed as nothing rather than guessed at: a migration that is a function, or a
// string the checker sees only as `string`, adds no table; a statement it does not parse is passed
// over; and a `table` of a name the fold does not hold is typed by the caller, as it always was.

/** 47.48 — a value's type, by the affinity SQLite gives its column's declared type. */
type ValueOf<Declared extends string> = Declared extends 'BOOLEAN' | 'BOOL'
    ? boolean
    : Declared extends 'JSON'
      ? unknown
      : Declared extends `${string}INT${string}`
        ? number
        : Declared extends
                | `${string}CHAR${string}`
                | `${string}CLOB${string}`
                | `${string}TEXT${string}`
          ? string
          : Declared extends `${string}BLOB${string}` | ''
            ? Uint8Array
            : Declared extends
                    | `${string}REAL${string}`
                    | `${string}FLOA${string}`
                    | `${string}DOUB${string}`
              ? number
              : number | string

/** `Text` with every `From` written as `To`: one step per occurrence, not per character. */
type ReplacedAll<
    Text extends string,
    From extends string,
    To extends string,
    Out extends string = '',
> = Text extends `${infer Before}${From}${infer After}`
    ? ReplacedAll<After, From, To, `${Out}${Before}${To}`>
    : `${Out}${Text}`

/** Every run of spaces one space, each pass halving the runs. */
type Collapsed<Text extends string> = Text extends `${string}  ${string}`
    ? Collapsed<ReplacedAll<Text, '  ', ' '>>
    : Text

/** The text with every `(`, `)` and `,` set apart by spaces, and all whitespace one space. */
type Spaced<Text extends string> = Collapsed<
    ReplacedAll<
        ReplacedAll<
            ReplacedAll<
                ReplacedAll<
                    ReplacedAll<ReplacedAll<Text, '\n', ' '>, '\t', ' '>,
                    '\r',
                    ' '
                >,
                '(',
                ' ( '
            >,
            ')',
            ' ) '
        >,
        ',',
        ' , '
    >
>

/** The words of spaced text, in order. */
type Words<
    Text extends string,
    Out extends string[] = [],
> = Text extends `${infer Word} ${infer Rest}`
    ? Words<Rest, Word extends '' ? Out : [...Out, Word]>
    : Text extends ''
      ? Out
      : [...Out, Text]

/** `Text` with each `--` comment taken out, to the end of its line. */
type Uncommented<
    Text extends string,
    Out extends string = '',
> = Text extends `${infer Before}--${infer Comment}`
    ? Comment extends `${string}\n${infer After}`
        ? Uncommented<After, `${Out}${Before}\n`>
        : `${Out}${Before}`
    : `${Out}${Text}`

/** `Text` past its leading whitespace. */
type TrimmedStart<Text extends string> =
    Text extends `${' ' | '\n' | '\t' | '\r'}${infer Rest}`
        ? TrimmedStart<Rest>
        : Text

/**
 * A statement 47.47 folds: one that makes, alters or drops a table. Every other — an index, a
 * trigger and the statements of its body, an insert — is passed over before a word of it is read,
 * which is what keeps a schema of many triggers inside the checker's depth.
 */
type Folded<Statement extends string> =
    Uppercase<TrimmedStart<Statement>> extends
        | `CREATE TABLE${string}`
        | `CREATE TEMP${string}`
        | `ALTER TABLE${string}`
        | `DROP TABLE${string}`
        ? true
        : false

/** The words of each statement 47.47 folds, split at `;` before any word is read. */
type Statements<
    Text extends string,
    Out extends string[][] = [],
> = Text extends `${infer Statement};${infer Rest}`
    ? Statements<
          Rest,
          Folded<Statement> extends true
              ? [...Out, Words<Spaced<Statement>>]
              : Out
      >
    : Folded<Text> extends true
      ? [...Out, Words<Spaced<Text>>]
      : Out

/** An identifier with its quotes taken off. */
type Unquoted<Word extends string> = Word extends `"${infer Name}"`
    ? Name
    : Word extends `\`${infer Name}\``
      ? Name
      : Word extends `[${infer Name}]`
        ? Name
        : Word

/** The words of a table's body, split at the commas outside any parentheses. */
type Definitions<
    Tokens extends string[],
    Depth extends unknown[] = [],
    Current extends string[] = [],
    Out extends string[][] = [],
> = Tokens extends [infer Head extends string, ...infer Rest extends string[]]
    ? Head extends '('
        ? Definitions<Rest, [...Depth, 0], [...Current, Head], Out>
        : Head extends ')'
          ? Depth extends [unknown, ...infer Shallower]
              ? Definitions<Rest, Shallower, [...Current, Head], Out>
              : // The body's own closing parenthesis: what follows is the table's options.
                [...Out, Current]
          : Head extends ','
            ? Depth extends []
                ? Definitions<Rest, Depth, [], [...Out, Current]>
                : Definitions<Rest, Depth, [...Current, Head], Out>
            : Definitions<Rest, Depth, [...Current, Head], Out>
    : [...Out, Current]

/** A word that ends a column's declared type and begins its constraints. */
type Constraint =
    | 'CONSTRAINT'
    | 'PRIMARY'
    | 'NOT'
    | 'NULL'
    | 'UNIQUE'
    | 'CHECK'
    | 'DEFAULT'
    | 'COLLATE'
    | 'REFERENCES'
    | 'GENERATED'
    | 'AS'
    | '('

/** The declared type: the words after a column's name and before its first constraint, upper case. */
type DeclaredType<
    Tokens extends string[],
    Out extends string = '',
> = Tokens extends [infer Head extends string, ...infer Rest extends string[]]
    ? Uppercase<Head> extends Constraint
        ? Out
        : DeclaredType<
              Rest,
              Out extends '' ? Uppercase<Head> : `${Out} ${Uppercase<Head>}`
          >
    : Out

/** Whether `First` and then `Second` follow one another anywhere in `Tokens`, in upper case. */
type Holds<
    Tokens extends string[],
    First extends string,
    Second extends string,
> = Tokens extends [infer Head extends string, ...infer Rest extends string[]]
    ? Uppercase<Head> extends First
        ? Rest extends [infer Next extends string, ...string[]]
            ? Uppercase<Next> extends Second
                ? true
                : Holds<Rest, First, Second>
            : false
        : Holds<Rest, First, Second>
    : false

/** Whether `Word` is anywhere in `Tokens`, in upper case. */
type HoldsWord<Tokens extends string[], Word extends string> = Tokens extends [
    infer Head extends string,
    ...infer Rest extends string[],
]
    ? Uppercase<Head> extends Word
        ? true
        : HoldsWord<Rest, Word>
    : false

/** A column as a migration declares it: its name, its value, whether a written row may leave it out. */
type Column = {
    name: string
    value: unknown
    optional: boolean
    assigned: boolean
}

/**
 * 47.48 — one column definition, or `never` for a table constraint. NULL unless `NOT NULL`, or an
 * `INTEGER PRIMARY KEY`, which is the row's id; left out of a written row where it may be NULL or has
 * a default, save a primary key, which a write names its row by (47.33).
 */
type ColumnOf<Tokens extends string[]> = Tokens extends [
    infer Name extends string,
    ...infer Rest extends string[],
]
    ? Uppercase<Name> extends
          'CONSTRAINT' | 'PRIMARY' | 'FOREIGN' | 'UNIQUE' | 'CHECK'
        ? never
        : DeclaredType<Rest> extends infer Declared extends string
          ? {
                name: Unquoted<Name>
                value: Holds<Rest, 'NOT', 'NULL'> extends true
                    ? ValueOf<Declared>
                    : Declared extends 'INTEGER'
                      ? HoldsWord<Rest, 'PRIMARY'> extends true
                          ? ValueOf<Declared>
                          : ValueOf<Declared> | null
                      : ValueOf<Declared> | null
                optional: HoldsWord<Rest, 'PRIMARY'> extends true
                    ? false
                    : Holds<Rest, 'NOT', 'NULL'> extends true
                      ? HoldsWord<Rest, 'DEFAULT'>
                      : true
                assigned: Declared extends 'INTEGER'
                    ? HoldsWord<Rest, 'PRIMARY'>
                    : false
            }
          : never
    : never

/** A table's columns, from its body's definitions. */
type ColumnsOf<
    Found extends string[][],
    Out extends Column[] = [],
> = Found extends [
    infer Head extends string[],
    ...infer Rest extends string[][],
]
    ? [ColumnOf<Head>] extends [never]
        ? ColumnsOf<Rest, Out>
        : ColumnsOf<Rest, [...Out, ColumnOf<Head>]>
    : Out

/** The words after `CREATE TABLE`, past an `IF NOT EXISTS`. */
type Created<Tokens extends string[]> = Tokens extends [
    infer If extends string,
    infer Not extends string,
    infer Exists extends string,
    ...infer Rest extends string[],
]
    ? [Uppercase<If>, Uppercase<Not>, Uppercase<Exists>] extends [
          'IF',
          'NOT',
          'EXISTS',
      ]
        ? Rest
        : Tokens
    : Tokens

/** The tables a schema holds, each a list of its columns. */
type Schema = Record<string, Column[]>

/** `Tables` without `Name`. */
type Without<Tables extends Schema, Name extends string> = {
    [Table in keyof Tables as Table extends Name ? never : Table]: Tables[Table]
}

/** `Tables` with `Name` holding `Columns`. */
type With<
    Tables extends Schema,
    Name extends string,
    Columns extends Column[],
> = Without<Tables, Name> & { [Table in Name]: Columns }

/** `Columns` but `Name`. */
type Dropped<Columns extends Column[], Name extends string> = Columns extends [
    infer Head extends Column,
    ...infer Rest extends Column[],
]
    ? Head['name'] extends Name
        ? Dropped<Rest, Name>
        : [Head, ...Dropped<Rest, Name>]
    : []

/** `Columns`, `From` called `To`. */
type Renamed<
    Columns extends Column[],
    From extends string,
    To extends string,
> = Columns extends [infer Head extends Column, ...infer Rest extends Column[]]
    ? [
          Head['name'] extends From
              ? {
                    name: To
                    value: Head['value']
                    optional: Head['optional']
                    assigned: Head['assigned']
                }
              : Head,
          ...Renamed<Rest, From, To>,
      ]
    : []

/** The name `DROP TABLE` names, past an `IF EXISTS`. */
type DroppedName<Tokens extends string[]> = Tokens extends [
    infer If extends string,
    infer Exists extends string,
    infer Name extends string,
]
    ? [Uppercase<If>, Uppercase<Exists>] extends ['IF', 'EXISTS']
        ? Unquoted<Name>
        : never
    : Tokens extends [infer Name extends string]
      ? Unquoted<Name>
      : never

/** 47.47 — `Tables` as one statement leaves them; a statement it does not parse leaves them be. */
type Applied<Tables extends Schema, Tokens extends string[]> = Tokens extends [
    infer Verb extends string,
    ...infer Rest extends string[],
]
    ? Uppercase<Verb> extends 'CREATE'
        ? Rest extends [
              infer Kind extends string,
              ...infer After extends string[],
          ]
            ? Uppercase<Kind> extends 'TEMP' | 'TEMPORARY'
                ? Applied<Tables, ['CREATE', ...After]>
                : Uppercase<Kind> extends 'TABLE'
                  ? Created<After> extends [
                        infer Name extends string,
                        '(',
                        ...infer Body extends string[],
                    ]
                      ? With<
                            Tables,
                            Unquoted<Name>,
                            ColumnsOf<Definitions<Body>>
                        >
                      : Tables
                  : Tables
            : Tables
        : Uppercase<Verb> extends 'DROP'
          ? Rest extends [
                infer Kind extends string,
                ...infer After extends string[],
            ]
              ? Uppercase<Kind> extends 'TABLE'
                  ? [DroppedName<After>] extends [never]
                      ? Tables
                      : Without<Tables, DroppedName<After>>
                  : Tables
              : Tables
          : Uppercase<Verb> extends 'ALTER'
            ? Rest extends [
                  infer Kind extends string,
                  infer Quoted extends string,
                  ...infer After extends string[],
              ]
                ? Uppercase<Kind> extends 'TABLE'
                    ? Unquoted<Quoted> extends infer Name extends keyof Tables &
                          string
                        ? Altered<Tables, Name, After>
                        : Tables
                    : Tables
                : Tables
            : Tables
    : Tables

/** The column `ADD [COLUMN]` declares. */
type AddedColumn<Tokens extends string[]> = Tokens extends [
    infer Word extends string,
    ...infer Definition extends string[],
]
    ? Uppercase<Word> extends 'COLUMN'
        ? ColumnOf<Definition>
        : ColumnOf<Tokens>
    : never

/** The column `DROP [COLUMN]` names. */
type DroppedColumn<Tokens extends string[]> = Tokens extends [
    infer Word extends string,
    infer Quoted extends string,
]
    ? Uppercase<Word> extends 'COLUMN'
        ? Unquoted<Quoted>
        : never
    : Tokens extends [infer Quoted extends string]
      ? Unquoted<Quoted>
      : never

/** `ALTER TABLE <Name> …`: a column added, dropped or renamed, or the table renamed. */
type Altered<
    Tables extends Schema,
    Name extends keyof Tables & string,
    Tokens extends string[],
> = Tokens extends [infer Verb extends string, ...infer Rest extends string[]]
    ? Uppercase<Verb> extends 'ADD'
        ? [AddedColumn<Rest>] extends [never]
            ? Tables
            : With<Tables, Name, [...Tables[Name], AddedColumn<Rest>]>
        : Uppercase<Verb> extends 'DROP'
          ? [DroppedColumn<Rest>] extends [never]
              ? Tables
              : With<Tables, Name, Dropped<Tables[Name], DroppedColumn<Rest>>>
          : Uppercase<Verb> extends 'RENAME'
            ? Rest extends [infer To extends string, infer Into extends string]
                ? Uppercase<To> extends 'TO'
                    ? With<Without<Tables, Name>, Unquoted<Into>, Tables[Name]>
                    : Tables
                : Rest extends [
                        infer Word extends string,
                        infer From extends string,
                        infer To extends string,
                        infer Into extends string,
                    ]
                  ? [Uppercase<Word>, Uppercase<To>] extends ['COLUMN', 'TO']
                      ? With<
                            Tables,
                            Name,
                            Renamed<
                                Tables[Name],
                                Unquoted<From>,
                                Unquoted<Into>
                            >
                        >
                      : Tables
                  : Rest extends [
                          infer From extends string,
                          infer To extends string,
                          infer Into extends string,
                      ]
                    ? Uppercase<To> extends 'TO'
                        ? With<
                              Tables,
                              Name,
                              Renamed<
                                  Tables[Name],
                                  Unquoted<From>,
                                  Unquoted<Into>
                              >
                          >
                        : Tables
                    : Tables
            : Tables
    : Tables

/** `Tables` after every statement in order. */
type AppliedAll<
    Tables extends Schema,
    Found extends string[][],
> = Found extends [
    infer Head extends string[],
    ...infer Rest extends string[][],
]
    ? AppliedAll<Flat<Applied<Tables, Head>>, Rest>
    : Tables

/** One object type, not an intersection growing per statement. */
type Flat<Tables> = { [Name in keyof Tables]: Tables[Name] } & {}

/** `Tables` after every migration that is SQL the checker can read; a function changes no type. */
type Migrated<
    Tables extends Schema,
    Migrations extends readonly unknown[],
> = Migrations extends readonly [infer Head, ...infer Rest]
    ? Migrated<
          Head extends string
              ? string extends Head
                  ? Tables
                  : AppliedAll<Tables, Statements<Uncommented<Head>>>
              : Tables,
          Rest
      >
    : Tables

/** A row read: every column, its value as declared. */
type RowOf<Columns extends Column[]> = {
    [Found in Columns[number] as Found['name']]: Found['value']
}

/** A row written: the columns it may not leave out, and the rest it may. */
type WrittenOf<Columns extends Column[]> = {
    [
        Found in Columns[number] as Found['optional'] extends true
            ? never
            : Found['name']
    ]: Found['value']
} & {
    [
        Found in Columns[number] as Found['optional'] extends true
            ? Found['name']
            : never
    ]?: Found['value']
}

/** A row inserted: a row written whose `INTEGER PRIMARY KEY` SQLite may assign. */
type InsertedOf<Columns extends Column[]> = {
    [
        Found in Columns[number] as Found['optional'] extends true
            ? never
            : Found['assigned'] extends true
              ? never
              : Found['name']
    ]: Found['value']
} & {
    [
        Found in Columns[number] as Found['optional'] extends true
            ? Found['name']
            : Found['assigned'] extends true
              ? Found['name']
              : never
    ]?: Found['value']
}

/** 47.47 — each table `Migrations` leave, by name: its row read, written and inserted. */
export type TablesOf<Migrations extends readonly unknown[]> =
    Migrated<{}, Migrations> extends infer Found extends Schema
        ? {
              [Name in keyof Found]: {
                  row: RowOf<Found[Name]>
                  written: Flat<WrittenOf<Found[Name]>>
                  inserted: Flat<InsertedOf<Found[Name]>>
              }
          }
        : {}

/** What an opener carries its tables under, for the checker alone: no value is ever at this key. */
export declare const TYPED_TABLES: unique symbol

/** An opener whose migrations the checker read: `TablesOf` its migrations, held by type alone. */
export type Typed<Tables> = { readonly [TYPED_TABLES]?: Tables | undefined }

/** An opener whose migrations the checker read none of, or a function that is no opener. */
export type Untyped = { readonly [TYPED_TABLES]?: undefined }

/** 47.49 — the row of each table the database `Opener` opens, by name: `Tables<typeof db>['deals']`. */
export type Tables<Opener> =
    Opener extends Typed<infer Found>
        ? {
              [Name in keyof Found]: Found[Name] extends { row: infer Row }
                  ? Row
                  : never
          }
        : never
