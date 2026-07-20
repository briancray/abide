import { describe, expect, test } from "bun:test";
import { createScanner } from "typescript/unstable/ast/scanner";
import { SyntaxKind } from "typescript/unstable/ast";
import { analyzeScope, collectFreeIdentifiers, rewriteCellRefs, rewriteFreeIdentifiers } from "./analyzeScope.ts";
import { parse } from "./parse.ts";

const CELLS = (...names: string[]): Set<string> => new Set(names);

// ---------------------------------------------------------------------------
// rewriteCellRefs — reads
// ---------------------------------------------------------------------------

describe("rewriteCellRefs reads", () => {
  test("simple read", () => {
    expect(rewriteCellRefs("n", CELLS("n"))).toBe("n.read()");
  });

  test("read inside an expression", () => {
    expect(rewriteCellRefs("n + 1", CELLS("n"))).toBe("n.read() + 1");
  });

  test("multiple cells", () => {
    expect(rewriteCellRefs("a + b", CELLS("a", "b"))).toBe("a.read() + b.read()");
  });

  test("non-cell identifier left alone", () => {
    expect(rewriteCellRefs("n + other", CELLS("n"))).toBe("n.read() + other");
  });

  test("empty cell set is a no-op", () => {
    expect(rewriteCellRefs("n = 5", CELLS())).toBe("n = 5");
  });

  test("read in a ternary", () => {
    expect(rewriteCellRefs("cond ? n : m", CELLS("n", "m"))).toBe("cond ? n.read() : m.read()");
  });
});

// ---------------------------------------------------------------------------
// rewriteCellRefs — assignment
// ---------------------------------------------------------------------------

describe("rewriteCellRefs assignment", () => {
  test("simple assignment", () => {
    expect(rewriteCellRefs("n = 5", CELLS("n"))).toBe("n.write( 5)");
  });

  test("assignment with expression RHS", () => {
    expect(rewriteCellRefs("n = a + 1", CELLS("n"))).toBe("n.write( a + 1)");
  });

  test("assignment RHS cells are also rewritten", () => {
    expect(rewriteCellRefs("n = a + 1", CELLS("n", "a"))).toBe("n.write( a.read() + 1)");
  });

  test("chained assignment nests writes", () => {
    expect(rewriteCellRefs("n = m = 5", CELLS("n", "m"))).toBe("n.write( m.write( 5))");
  });

  test("assignment inside a call closes before the paren", () => {
    expect(rewriteCellRefs("foo(n = 1)", CELLS("n"))).toBe("foo(n.write( 1))");
  });

  test("assignment RHS stops at a comma", () => {
    expect(rewriteCellRefs("f(n = 1, 2)", CELLS("n"))).toBe("f(n.write( 1), 2)");
  });

  test("assignment RHS spanning a ternary", () => {
    expect(rewriteCellRefs("n = a ? b : c", CELLS("n"))).toBe("n.write( a ? b : c)");
  });
});

// ---------------------------------------------------------------------------
// rewriteCellRefs — compound assignment (all operators)
// ---------------------------------------------------------------------------

describe("rewriteCellRefs compound assignment", () => {
  const cases: [string, string][] = [
    ["n += x", "n.write(n.read() + ( x))"],
    ["n -= x", "n.write(n.read() - ( x))"],
    ["n *= x", "n.write(n.read() * ( x))"],
    ["n /= x", "n.write(n.read() / ( x))"],
    ["n %= x", "n.write(n.read() % ( x))"],
    ["n **= x", "n.write(n.read() ** ( x))"],
    ["n &= x", "n.write(n.read() & ( x))"],
    ["n |= x", "n.write(n.read() | ( x))"],
    ["n ^= x", "n.write(n.read() ^ ( x))"],
    ["n <<= x", "n.write(n.read() << ( x))"],
    ["n >>= x", "n.write(n.read() >> ( x))"],
    ["n >>>= x", "n.write(n.read() >>> ( x))"],
    ["n &&= x", "n.write(n.read() && ( x))"],
    ["n ||= x", "n.write(n.read() || ( x))"],
    ["n ??= x", "n.write(n.read() ?? ( x))"],
  ];
  for (const [input, expected] of cases) {
    test(input, () => {
      expect(rewriteCellRefs(input, CELLS("n"))).toBe(expected);
    });
  }

  test("compound RHS is parenthesized to preserve precedence", () => {
    expect(rewriteCellRefs("n += a + b", CELLS("n"))).toBe("n.write(n.read() + ( a + b))");
  });
});

// ---------------------------------------------------------------------------
// rewriteCellRefs — increment / decrement
// ---------------------------------------------------------------------------

describe("rewriteCellRefs increment/decrement", () => {
  test("postfix ++", () => {
    expect(rewriteCellRefs("n++", CELLS("n"))).toBe("n.write(n.read() + 1)");
  });
  test("postfix --", () => {
    expect(rewriteCellRefs("n--", CELLS("n"))).toBe("n.write(n.read() - 1)");
  });
  test("prefix ++", () => {
    expect(rewriteCellRefs("++n", CELLS("n"))).toBe("n.write(n.read() + 1)");
  });
  test("prefix --", () => {
    expect(rewriteCellRefs("--n", CELLS("n"))).toBe("n.write(n.read() - 1)");
  });
  test("prefix increment mid-expression", () => {
    expect(rewriteCellRefs("a + ++n", CELLS("n"))).toBe("a + n.write(n.read() + 1)");
  });
  test("postfix increment mid-expression", () => {
    expect(rewriteCellRefs("n++ + a", CELLS("n"))).toBe("n.write(n.read() + 1) + a");
  });
  test("non-cell postfix left alone", () => {
    expect(rewriteCellRefs("x++", CELLS("n"))).toBe("x++");
  });
});

// ---------------------------------------------------------------------------
// rewriteCellRefs — operator disambiguation (`=` vs `==`/`===`/`=>`/`<=`/`>=`/`!=`)
// ---------------------------------------------------------------------------

describe("rewriteCellRefs operator disambiguation", () => {
  test("== is not an assignment", () => {
    expect(rewriteCellRefs("n == 5", CELLS("n"))).toBe("n.read() == 5");
  });
  test("=== is not an assignment", () => {
    expect(rewriteCellRefs("n === 5", CELLS("n"))).toBe("n.read() === 5");
  });
  test("!= / !== are not assignments", () => {
    expect(rewriteCellRefs("n != 5", CELLS("n"))).toBe("n.read() != 5");
    expect(rewriteCellRefs("n !== 5", CELLS("n"))).toBe("n.read() !== 5");
  });
  test("<= and >= are not assignments", () => {
    expect(rewriteCellRefs("n <= 5", CELLS("n"))).toBe("n.read() <= 5");
    expect(rewriteCellRefs("n >= 5", CELLS("n"))).toBe("n.read() >= 5");
  });
  test("=> single-param arrow is not an assignment (param shadows)", () => {
    expect(rewriteCellRefs("n => n + 1", CELLS("n"))).toBe("n => n + 1");
  });
});

// ---------------------------------------------------------------------------
// rewriteCellRefs — member access, object keys, shorthand
// ---------------------------------------------------------------------------

describe("rewriteCellRefs member and object handling", () => {
  test("member access is not rewritten", () => {
    expect(rewriteCellRefs("obj.n", CELLS("n"))).toBe("obj.n");
  });
  test("optional member access is not rewritten", () => {
    expect(rewriteCellRefs("obj?.n", CELLS("n"))).toBe("obj?.n");
  });
  test("cell before a member access still reads", () => {
    expect(rewriteCellRefs("n.foo", CELLS("n"))).toBe("n.read().foo");
  });
  test("object key is not rewritten", () => {
    expect(rewriteCellRefs("({ n: 1 })", CELLS("n"))).toBe("({ n: 1 })");
  });
  test("object shorthand becomes a read", () => {
    expect(rewriteCellRefs("({ n })", CELLS("n"))).toBe("({ n: n.read() })");
  });
  test("mixed keys and shorthand", () => {
    expect(rewriteCellRefs("({ a, n: 1, b })", CELLS("a", "b"))).toBe("({ a: a.read(), n: 1, b: b.read() })");
  });
  test("object value position is a read", () => {
    expect(rewriteCellRefs("({ k: n })", CELLS("n"))).toBe("({ k: n.read() })");
  });
  test("object method name is not rewritten", () => {
    expect(rewriteCellRefs("({ n() { return 1 } })", CELLS("n"))).toBe("({ n() { return 1 } })");
  });
});

// ---------------------------------------------------------------------------
// rewriteCellRefs — string / template / comment literals
// ---------------------------------------------------------------------------

describe("rewriteCellRefs literals are protected", () => {
  test("cell inside a double-quoted string is not rewritten", () => {
    expect(rewriteCellRefs('"n is n"', CELLS("n"))).toBe('"n is n"');
  });
  test("cell inside a single-quoted string is not rewritten", () => {
    expect(rewriteCellRefs("'n'", CELLS("n"))).toBe("'n'");
  });
  test("cell inside a no-substitution template is not rewritten", () => {
    expect(rewriteCellRefs("`n and n`", CELLS("n"))).toBe("`n and n`");
  });
  test("template substitution IS rewritten, surrounding text is not", () => {
    expect(rewriteCellRefs("`x${n}y`", CELLS("n"))).toBe("`x${n.read()}y`");
  });
  test("multiple template substitutions", () => {
    expect(rewriteCellRefs("`${n}-${m}`", CELLS("n", "m"))).toBe("`${n.read()}-${m.read()}`");
  });
  test("template tail text matching a cell name is not rewritten", () => {
    // After `${a}` the literal `n` is template tail text, not code.
    expect(rewriteCellRefs("`${a}n`", CELLS("a", "n"))).toBe("`${a.read()}n`");
  });
  test("cell in a line comment is not rewritten", () => {
    expect(rewriteCellRefs("a // n\n+ a", CELLS("a", "n"))).toBe("a.read() // n\n+ a.read()");
  });
});

// ---------------------------------------------------------------------------
// rewriteCellRefs — declaration sites and shadowing
// ---------------------------------------------------------------------------

describe("rewriteCellRefs declarations and shadowing", () => {
  test("top-level declaration keeps the lexical name; later refs rewrite", () => {
    expect(rewriteCellRefs("let n = state(0); n = 5; n + 1", CELLS("n"))).toBe("let n = state(0); n.write( 5); n.read() + 1");
  });

  test("function parameter shadows the cell in the body", () => {
    expect(rewriteCellRefs("function f(n){ return n } n", CELLS("n"))).toBe("function f(n){ return n } n.read()");
  });

  test("multi-param arrow parameter shadows in the body", () => {
    expect(rewriteCellRefs("(a, n) => n + count", CELLS("n", "count"))).toBe("(a, n) => n + count.read()");
  });

  test("nested let shadows the cell in that block", () => {
    expect(rewriteCellRefs("function g(){ let n = 5; return n } n", CELLS("n"))).toBe("function g(){ let n = 5; return n } n.read()");
  });

  test("cell referenced inside a non-shadowing function still rewrites", () => {
    expect(rewriteCellRefs("function h(){ return n + 1 }", CELLS("n"))).toBe("function h(){ return n.read() + 1 }");
  });

  test("references before a nested shadow still rewrite", () => {
    expect(rewriteCellRefs("n; function f(n){ return n }", CELLS("n"))).toBe("n.read(); function f(n){ return n }");
  });
});

// ---------------------------------------------------------------------------
// collectFreeIdentifiers
// ---------------------------------------------------------------------------

describe("collectFreeIdentifiers", () => {
  test("returns undeclared, non-global identifiers", () => {
    const free = collectFreeIdentifiers("a + b + c", CELLS("a"));
    expect([...free].sort()).toEqual(["b", "c"]);
  });

  test("skips property accesses and object keys", () => {
    const free = collectFreeIdentifiers("obj.prop + { key: value }", CELLS());
    expect([...free].sort()).toEqual(["obj", "value"]);
  });

  test("object shorthand counts as a free read", () => {
    const free = collectFreeIdentifiers("({ x })", CELLS());
    expect([...free]).toEqual(["x"]);
  });

  test("skips JS globals", () => {
    const free = collectFreeIdentifiers("Math.max(a, undefined)", CELLS());
    expect([...free]).toEqual(["a"]);
  });

  test("skips arrow parameters (locals)", () => {
    const free = collectFreeIdentifiers("items.map(x => x + y)", CELLS());
    expect([...free].sort()).toEqual(["items", "y"]);
  });

  test("skips declared names", () => {
    const free = collectFreeIdentifiers("greet + state", CELLS("greet", "state"));
    expect([...free]).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// rewriteFreeIdentifiers — type-position operands (TODO #11 / #18 follow-up)
// ---------------------------------------------------------------------------

describe("rewriteFreeIdentifiers type-position operands", () => {
  const rw = (code: string) => rewriteFreeIdentifiers(code, CELLS(), "$s");

  test("value operand rewritten, `as` type operand left alone", () => {
    expect(rw("(x as Foo).bar")).toBe("($s.x as Foo).bar");
  });

  test("qualified type name is not rewritten", () => {
    expect(rw("x as Foo.Bar")).toBe("$s.x as Foo.Bar");
  });

  test("array type suffix is not rewritten", () => {
    expect(rw("value as Widget[]")).toBe("$s.value as Widget[]");
  });

  test("primitive-keyword union type is not rewritten", () => {
    expect(rw("n as string | number")).toBe("$s.n as string | number");
  });

  test("generic type arguments are not rewritten", () => {
    expect(rw("x as Map<string, User>")).toBe("$s.x as Map<string, User>");
  });

  test("intersection type is not rewritten", () => {
    expect(rw("x as A & B & C")).toBe("$s.x as A & B & C");
  });

  test("leading `readonly` type operator is not rewritten", () => {
    expect(rw("arr as readonly Item[]")).toBe("$s.arr as readonly Item[]");
  });

  test("object / function types are not rewritten", () => {
    expect(rw("obj as { a: Foo }")).toBe("$s.obj as { a: Foo }");
    expect(rw("f as (p: P) => R")).toBe("$s.f as (p: P) => R");
  });

  test("`satisfies` operand is not rewritten", () => {
    expect(rw("x satisfies Config")).toBe("$s.x satisfies Config");
  });

  test("double assertion", () => {
    expect(rw("x as unknown as Bar")).toBe("$s.x as unknown as Bar");
  });

  // The safety invariant: values AFTER the type must stay rewritten (never over-skip into value pos).
  test("ternary arms after `x as Foo ?` stay rewritten", () => {
    expect(rw("x as Foo ? a : b")).toBe("$s.x as Foo ? $s.a : $s.b");
  });

  test("operand after the assertion stays rewritten", () => {
    expect(rw("(x as Foo) + y")).toBe("($s.x as Foo) + $s.y");
    expect(rw("x as Foo, y")).toBe("$s.x as Foo, $s.y");
  });

  test("a plain `<` comparison (no `as`) is untouched", () => {
    expect(rw("a < b")).toBe("$s.a < $s.b");
  });

  test("assertion inside a ternary branch", () => {
    expect(rw("x ? y as T : z")).toBe("$s.x ? $s.y as T : $s.z");
  });
});

// ---------------------------------------------------------------------------
// analyzeScope — cell recognition + real dual-script root
// ---------------------------------------------------------------------------

describe("analyzeScope cell recognition", () => {
  test("state / computed / linked recognized", () => {
    const root = parse(
      "<script>import { state } from 'abide/ui/state'; let n = state(0); const d = state.computed(()=>n*2); let e = state.linked(()=>n)</script>{n}",
    );
    const analysis = analyzeScope(root);
    expect([...analysis.cellNames].sort()).toEqual(["d", "e", "n"]);
    const kinds = Object.fromEntries(analysis.instance!.bindings.map((b) => [b.name, b.kind]));
    expect(kinds.n).toBe("state");
    expect(kinds.d).toBe("computed");
    expect(kinds.e).toBe("linked");
  });

  test("aliased state import (import { state as s })", () => {
    const root = parse("<script>import { state as s } from 'abide/ui/state'; let n = s(0); let d = s.linked(()=>n)</script>{n}");
    const analysis = analyzeScope(root);
    expect([...analysis.cellNames].sort()).toEqual(["d", "n"]);
    expect(analysis.instance!.setupCode).toBe(" let n = s(0); let d = s.linked(()=>n.read())");
  });

  test("props() destructuring marks bindings as prop", () => {
    const root = parse("<script>import { props } from 'abide/ui/props'; const {who, age} = props()</script>{who}");
    const analysis = analyzeScope(root);
    const kinds = Object.fromEntries(analysis.instance!.bindings.map((b) => [b.name, b.kind]));
    expect(kinds.who).toBe("prop");
    expect(kinds.age).toBe("prop");
    expect(analysis.cellNames.size).toBe(0);
  });

  test("dual-script root: module + instance", () => {
    const root = parse(
      "<script module>import { state } from 'abide/ui/state'; let g = state(1)</script>" +
        "<script>import { props } from 'abide/ui/props'; import greet from '../rpc/greet'; let n = state(0); function inc(){ n++ }</script>" +
        "<p>{n}</p>",
    );
    const analysis = analyzeScope(root);

    expect([...analysis.cellNames].sort()).toEqual(["g", "n"]);
    expect(analysis.declared.has("state")).toBe(true);
    expect(analysis.declared.has("greet")).toBe(true);
    expect(analysis.declared.has("inc")).toBe(true);

    // module setup keeps its lexical cell; imports are stripped.
    expect(analysis.module!.setupCode).toContain("let g = state(1)");
    expect(analysis.module!.setupCode).not.toContain("import");
    expect(analysis.module!.imports[0]!.specifier).toBe("abide/ui/state");

    // instance setup rewrites the cell reference inside the function body; imports stripped.
    expect(analysis.instance!.setupCode).toContain("function inc(){ n.write(n.read() + 1) }");
    expect(analysis.instance!.setupCode).not.toContain("import");
    const instanceImports = analysis.instance!.imports.map((i) => i.specifier).sort();
    expect(instanceImports).toEqual(["../rpc/greet", "abide/ui/props"]);
  });

  test("null scripts when absent", () => {
    const root = parse("<p>hello</p>");
    const analysis = analyzeScope(root);
    expect(analysis.module).toBeNull();
    expect(analysis.instance).toBeNull();
    expect(analysis.cellNames.size).toBe(0);
  });

  test("module cells do not rewrite instance-only names and vice versa", () => {
    const root = parse(
      "<script module>import { state } from 'abide/ui/state'; let g = state(1)</script>" +
        "<script>import { state } from 'abide/ui/state'; let n = state(0)</script>{n}",
    );
    const analysis = analyzeScope(root);
    // instance can reference module cell g:
    expect([...analysis.cellNames].sort()).toEqual(["g", "n"]);
  });
});

// ---------------------------------------------------------------------------
// Fuzz / property test
// ---------------------------------------------------------------------------

// Tokenize helper mirroring analyzeScope's scanner usage (build-time only).
function scanKinds(source: string): { kind: SyntaxKind; text: string }[] {
  const scanner = createScanner(true, 0, source);
  const out: { kind: SyntaxKind; text: string }[] = [];
  const frames: string[] = [];
  for (;;) {
    let kind = scanner.scan();
    if (kind === SyntaxKind.EndOfFile) break;
    if (kind === SyntaxKind.CloseBraceToken && frames[frames.length - 1] === "t") {
      kind = scanner.reScanTemplateToken(false);
      if (kind === SyntaxKind.TemplateTail) frames.pop();
    } else if (kind === SyntaxKind.TemplateHead) frames.push("t");
    else if (kind === SyntaxKind.OpenBraceToken) frames.push("b");
    else if (kind === SyntaxKind.CloseBraceToken) frames.pop();
    out.push({ kind, text: scanner.getTokenText() });
  }
  return out;
}

describe("rewriteCellRefs fuzz/property", () => {
  // Small seeded PRNG for reproducibility.
  function makeRng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0x100000000;
    };
  }

  const CELL_NAMES = ["a", "b", "c"];
  const cellSet = CELLS(...CELL_NAMES);

  // Each fragment is valid JS on its own and, per the rewrite rules, must contain no bare cell read.
  function makeFragment(rng: () => number): string {
    const cell = CELL_NAMES[Math.floor(rng() * CELL_NAMES.length)]!;
    const forms = [cell, `${cell} = 2`, `${cell} += 3`, `${cell} -= 1`, `${cell} *= 2`, `${cell} ??= 4`, `${cell}++`, `${cell}--`, `++${cell}`, `--${cell}`, `${cell} + 1`];
    return forms[Math.floor(rng() * forms.length)]!;
  }

  test("output re-parses and no cell survives as a bare read", () => {
    const rng = makeRng(0xc0ffee);
    for (let iteration = 0; iteration < 500; iteration++) {
      const count = 1 + Math.floor(rng() * 4);
      const fragments: string[] = [];
      for (let f = 0; f < count; f++) fragments.push(makeFragment(rng));
      const input = fragments.join("; ");
      const output = rewriteCellRefs(input, cellSet);

      // 1. Output must compile (no error/Unknown tokens; valid as a function body).
      expect(() => new Function("a", "b", "c", output)).not.toThrow();
      const tokens = scanKinds(output);
      for (const tok of tokens) expect(tok.kind).not.toBe(SyntaxKind.Unknown);

      // 2. No bare cell read survives: every cell-named identifier is immediately followed by
      //    `.read(` / `.write(` (these fragments contain no declarations, members, or object keys).
      for (let i = 0; i < tokens.length; i++) {
        const tok = tokens[i]!;
        if (tok.kind !== SyntaxKind.Identifier) continue;
        if (!cellSet.has(tok.text)) continue;
        const next = tokens[i + 1];
        const after = tokens[i + 2];
        const followedByAccessor =
          next !== undefined &&
          next.kind === SyntaxKind.DotToken &&
          after !== undefined &&
          (after.text === "read" || after.text === "write");
        expect(followedByAccessor).toBe(true);
      }
    }
  });
});
