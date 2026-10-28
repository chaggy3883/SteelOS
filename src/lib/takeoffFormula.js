// Safe formula evaluator for IRONSIGHT custom takeoff columns.
//
// Estimators type spreadsheet-style formulas into a formula column (e.g.
// `Length * WtPerFt * Qty / 2000`). This module tokenizes and parses that
// text into a small syntax tree and walks it — it NEVER hands user text to
// eval() / new Function(), so a formula can only ever do arithmetic,
// comparisons and the whitelisted functions below.
//
// Supported:
//   numbers (12, 0.5, .25, 1e3), "text" or 'text' literals, TRUE/FALSE
//   + - * / ^ (also the typed symbols × ÷ − for people pasting from docs)
//   parentheses, unary minus/plus
//   comparisons = == != <> < <= > >= (yield 1 / 0)
//   & joins text (e.g. Size & " " & Grade)
//   IF(cond, a, b)            — only the chosen branch is evaluated
//   ROUND(x[, n]) MIN(...) MAX(...) ABS(x) CEILING(x[, step]) FLOOR(x[, step])
//   SQRT(x) AND(...) OR(...) NOT(x)
//   column references by alias, case-insensitive (Length, wtperft, QTY ...)
//
// Every public function returns { value, error } (or { ok, error }) instead
// of throwing, with plain-language error text an estimator can act on.

const FUNCTION_SPECS = {
  IF: { min: 3, max: 3, help: 'IF(condition, value if true, value if false)' },
  ROUND: { min: 1, max: 2, help: 'ROUND(number, decimals) — decimals defaults to 0' },
  MIN: { min: 1, max: Infinity, help: 'MIN(a, b, ...) — smallest value' },
  MAX: { min: 1, max: Infinity, help: 'MAX(a, b, ...) — largest value' },
  ABS: { min: 1, max: 1, help: 'ABS(number) — drops the minus sign' },
  CEILING: { min: 1, max: 2, help: 'CEILING(number, step) — rounds up to the next step (default 1)' },
  FLOOR: { min: 1, max: 2, help: 'FLOOR(number, step) — rounds down to the step (default 1)' },
  SQRT: { min: 1, max: 1, help: 'SQRT(number) — square root' },
  AND: { min: 1, max: Infinity, help: 'AND(a, b, ...) — 1 when every value is true' },
  OR: { min: 1, max: Infinity, help: 'OR(a, b, ...) — 1 when any value is true' },
  NOT: { min: 1, max: 1, help: 'NOT(value) — flips true/false' },
};

export const FORMULA_FUNCTIONS = Object.entries(FUNCTION_SPECS).map(([name, spec]) => ({ name, help: spec.help }));

export const RESERVED_WORDS = [...Object.keys(FUNCTION_SPECS), 'TRUE', 'FALSE'];

class FormulaError extends Error {}

const fail = (message) => {
  throw new FormulaError(message);
};

// ---------------------------------------------------------------- tokenizer

const OPERATOR_ALIASES = { '×': '*', '÷': '/', '−': '-', '–': '-', '≠': '!=', '≤': '<=', '≥': '>=' };
const TWO_CHAR_OPS = ['<=', '>=', '!=', '<>', '=='];
const ONE_CHAR_OPS = ['+', '-', '*', '/', '^', '(', ')', ',', '<', '>', '=', '&'];

function tokenize(input) {
  const src = String(input ?? '');
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    let ch = src[i];
    if (/\s/.test(ch)) { i += 1; continue; }
    if (OPERATOR_ALIASES[ch]) ch = OPERATOR_ALIASES[ch];

    // number: 12  12.5  .5  1e3  1.2E-4
    if (/[0-9.]/.test(ch)) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) fail(`"${ch}" at position ${i + 1} isn't a valid number.`);
      tokens.push({ type: 'num', value: parseFloat(m[0]), pos: i });
      i += m[0].length;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const quote = ch;
      const end = src.indexOf(quote, i + 1);
      if (end < 0) fail(`Text starting at position ${i + 1} is missing its closing ${quote}.`);
      tokens.push({ type: 'str', value: src.slice(i + 1, end), pos: i });
      i = end + 1;
      continue;
    }

    // identifier: letters, digits, underscore; may not start with a digit.
    // Square brackets let a name with spaces be referenced: [Wt Per Ft].
    if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
      tokens.push({ type: 'ident', value: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    if (ch === '[') {
      const end = src.indexOf(']', i + 1);
      if (end < 0) fail(`The name starting with "[" at position ${i + 1} is missing its closing "]".`);
      const name = src.slice(i + 1, end).trim();
      if (!name) fail(`Empty [ ] at position ${i + 1}.`);
      tokens.push({ type: 'ident', value: name, pos: i, bracketed: true });
      i = end + 1;
      continue;
    }

    const two = src.slice(i, i + 2);
    if (TWO_CHAR_OPS.includes(two)) {
      tokens.push({ type: 'op', value: two === '<>' ? '!=' : two === '==' ? '=' : two, pos: i });
      i += 2;
      continue;
    }
    if (ONE_CHAR_OPS.includes(ch)) {
      tokens.push({ type: 'op', value: ch, pos: i });
      i += 1;
      continue;
    }
    fail(`"${src[i]}" at position ${i + 1} isn't allowed in a formula.`);
  }
  tokens.push({ type: 'eof', pos: src.length });
  return tokens;
}

// ------------------------------------------------------------------- parser
// Precedence (low → high): comparison, &, + -, * /, unary, ^, primary.

function parseTokens(tokens) {
  let p = 0;
  const peek = () => tokens[p];
  const next = () => tokens[p++];
  const isOp = (v) => peek().type === 'op' && peek().value === v;
  const expectOp = (v, context) => {
    if (!isOp(v)) {
      const t = peek();
      const got = t.type === 'eof' ? 'the end of the formula' : `"${t.value}"`;
      fail(`Expected "${v}" ${context} but found ${got}.`);
    }
    next();
  };

  const parseComparison = () => {
    let left = parseConcat();
    while (peek().type === 'op' && ['=', '!=', '<', '<=', '>', '>='].includes(peek().value)) {
      const op = next().value;
      left = { kind: 'bin', op, left, right: parseConcat() };
    }
    return left;
  };
  const parseConcat = () => {
    let left = parseAdditive();
    while (isOp('&')) {
      next();
      left = { kind: 'bin', op: '&', left, right: parseAdditive() };
    }
    return left;
  };
  const parseAdditive = () => {
    let left = parseMultiplicative();
    while (isOp('+') || isOp('-')) {
      const op = next().value;
      left = { kind: 'bin', op, left, right: parseMultiplicative() };
    }
    return left;
  };
  const parseMultiplicative = () => {
    let left = parseUnary();
    while (isOp('*') || isOp('/')) {
      const op = next().value;
      left = { kind: 'bin', op, left, right: parseUnary() };
    }
    return left;
  };
  const parseUnary = () => {
    if (isOp('-') || isOp('+')) {
      const op = next().value;
      const operand = parseUnary();
      return op === '-' ? { kind: 'neg', operand } : operand;
    }
    return parsePower();
  };
  // Right-associative; binds tighter than unary minus on its left, so -2^2 = -4.
  const parsePower = () => {
    const base = parsePrimary();
    if (isOp('^')) {
      next();
      return { kind: 'bin', op: '^', left: base, right: parseUnary() };
    }
    return base;
  };
  const parsePrimary = () => {
    const t = peek();
    if (t.type === 'num') { next(); return { kind: 'num', value: t.value }; }
    if (t.type === 'str') { next(); return { kind: 'str', value: t.value }; }
    if (isOp('(')) {
      next();
      const inner = parseComparison();
      expectOp(')', 'to close the parenthesis');
      return inner;
    }
    if (t.type === 'ident') {
      next();
      const upper = t.value.toUpperCase();
      if (!t.bracketed && isOp('(')) {
        if (!FUNCTION_SPECS[upper]) fail(`"${t.value}" isn't a function this formula supports. Try: ${Object.keys(FUNCTION_SPECS).join(', ')}.`);
        next();
        const args = [];
        if (!isOp(')')) {
          args.push(parseComparison());
          while (isOp(',')) { next(); args.push(parseComparison()); }
        }
        expectOp(')', `to close ${upper}(`);
        const spec = FUNCTION_SPECS[upper];
        if (args.length < spec.min || args.length > spec.max) {
          fail(`${upper} takes ${spec.min === spec.max ? spec.min : `${spec.min}${spec.max === Infinity ? ' or more' : `–${spec.max}`}`} value${spec.max === 1 ? '' : 's'} — usage: ${spec.help}.`);
        }
        return { kind: 'call', name: upper, args };
      }
      if (!t.bracketed && (upper === 'TRUE' || upper === 'FALSE')) return { kind: 'num', value: upper === 'TRUE' ? 1 : 0 };
      if (!t.bracketed && FUNCTION_SPECS[upper]) fail(`${upper} is a function — it needs parentheses, e.g. ${FUNCTION_SPECS[upper].help}.`);
      return { kind: 'ref', name: t.value };
    }
    if (t.type === 'eof') fail('The formula ends too early — something is missing after the last operator.');
    fail(`Unexpected "${t.value}" at position ${t.pos + 1}.`);
    return null;
  };

  if (peek().type === 'eof') fail('The formula is empty.');
  const ast = parseComparison();
  if (peek().type !== 'eof') {
    const t = peek();
    fail(`Unexpected "${t.value}" at position ${t.pos + 1} — is an operator missing?`);
  }
  return ast;
}

// ------------------------------------------------------------- evaluation

const truthy = (v) => (typeof v === 'string' ? v.length > 0 : Boolean(v) && !Number.isNaN(v));

const toNumber = (v, what) => {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v == null || v === '') return 0;
  const n = Number(v);
  if (Number.isFinite(n)) return n;
  fail(`${what} is "${v}", which isn't a number.`);
  return 0;
};

const describe = (node) => {
  if (!node) return 'a value';
  if (node.kind === 'ref') return node.name;
  if (node.kind === 'num') return String(node.value);
  if (node.kind === 'call') return `${node.name}(...)`;
  return 'a value';
};

const stepRound = (x, step, fn) => {
  if (step === 0) return 0;
  return fn(x / step) * step;
};

function evalNode(node, lookup) {
  switch (node.kind) {
    case 'num':
    case 'str':
      return node.value;
    case 'ref':
      return lookup(node.name);
    case 'neg':
      return -toNumber(evalNode(node.operand, lookup), describe(node.operand));
    case 'bin': {
      const l = evalNode(node.left, lookup);
      const r = evalNode(node.right, lookup);
      if (node.op === '&') return `${l ?? ''}${r ?? ''}`;
      if (['=', '!=', '<', '<=', '>', '>='].includes(node.op)) {
        let a = l; let b = r;
        const bothNumeric = [a, b].every((v) => typeof v === 'number' || typeof v === 'boolean' || (v !== '' && v != null && Number.isFinite(Number(v))));
        if (bothNumeric) { a = Number(a); b = Number(b); } else { a = String(a ?? '').toLowerCase(); b = String(b ?? '').toLowerCase(); }
        switch (node.op) {
          case '=': return a === b ? 1 : 0;
          case '!=': return a !== b ? 1 : 0;
          case '<': return a < b ? 1 : 0;
          case '<=': return a <= b ? 1 : 0;
          case '>': return a > b ? 1 : 0;
          default: return a >= b ? 1 : 0;
        }
      }
      const a = toNumber(l, describe(node.left));
      const b = toNumber(r, describe(node.right));
      switch (node.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/':
          if (b === 0) fail(`Division by zero — ${describe(node.right)} is 0.`);
          return a / b;
        case '^': {
          const v = a ** b;
          if (!Number.isFinite(v)) fail(`${describe(node.left)} ^ ${describe(node.right)} doesn't give a real number.`);
          return v;
        }
        default: fail(`Unknown operator ${node.op}.`);
      }
      return 0;
    }
    case 'call': {
      const { name, args } = node;
      if (name === 'IF') return truthy(evalNode(args[0], lookup)) ? evalNode(args[1], lookup) : evalNode(args[2], lookup);
      if (name === 'AND') return args.every((a) => truthy(evalNode(a, lookup))) ? 1 : 0;
      if (name === 'OR') return args.some((a) => truthy(evalNode(a, lookup))) ? 1 : 0;
      if (name === 'NOT') return truthy(evalNode(args[0], lookup)) ? 0 : 1;
      const nums = args.map((a) => toNumber(evalNode(a, lookup), describe(a)));
      switch (name) {
        case 'ROUND': {
          const digits = Math.trunc(nums[1] ?? 0);
          if (digits < -10 || digits > 10) fail('ROUND decimals must be between -10 and 10.');
          const f = 10 ** digits;
          // Nudge by EPSILON so 1.005 rounds to 1.01 like a spreadsheet would.
          return Math.sign(nums[0]) * Math.round(Math.abs(nums[0]) * f * (1 + Number.EPSILON)) / f;
        }
        case 'MIN': return Math.min(...nums);
        case 'MAX': return Math.max(...nums);
        case 'ABS': return Math.abs(nums[0]);
        case 'SQRT':
          if (nums[0] < 0) fail(`SQRT of a negative number (${nums[0]}) isn't allowed.`);
          return Math.sqrt(nums[0]);
        case 'CEILING': return stepRound(nums[0], Math.abs(nums[1] ?? 1), Math.ceil);
        case 'FLOOR': return stepRound(nums[0], Math.abs(nums[1] ?? 1), Math.floor);
        default: fail(`Unknown function ${name}.`);
      }
      return 0;
    }
    default:
      fail('Unrecognized formula part.');
      return 0;
  }
}

// ------------------------------------------------------------------ public

const astCache = new Map();
const AST_CACHE_LIMIT = 500;

/** Parse formula text. Returns { ast, error }. Results are cached by text. */
export function parseFormula(expr) {
  const key = String(expr ?? '');
  if (astCache.has(key)) return astCache.get(key);
  let result;
  try {
    result = { ast: parseTokens(tokenize(key)), error: null };
  } catch (e) {
    result = { ast: null, error: e instanceof FormulaError ? e.message : `Couldn't read the formula: ${e?.message || e}` };
  }
  if (astCache.size >= AST_CACHE_LIMIT) astCache.clear();
  astCache.set(key, result);
  return result;
}

/** Every column alias the formula refers to, in first-use order, de-duplicated case-insensitively. */
export function getFormulaReferences(expr) {
  const { ast } = parseFormula(expr);
  const seen = new Map();
  const walk = (n) => {
    if (!n) return;
    if (n.kind === 'ref' && !seen.has(n.name.toLowerCase())) seen.set(n.name.toLowerCase(), n.name);
    if (n.kind === 'neg') walk(n.operand);
    if (n.kind === 'bin') { walk(n.left); walk(n.right); }
    if (n.kind === 'call') n.args.forEach(walk);
  };
  walk(ast);
  return [...seen.values()];
}

const buildLookup = (variables) => {
  const map = new Map();
  Object.entries(variables || {}).forEach(([k, v]) => map.set(k.toLowerCase(), v));
  return (name) => {
    const key = name.toLowerCase();
    if (!map.has(key)) {
      const names = [...Object.keys(variables || {})];
      fail(`Unknown column "${name}".${names.length ? ` Available: ${names.join(', ')}.` : ''}`);
    }
    const v = map.get(key);
    if (v && typeof v === 'object' && 'error' in v && v.error) fail(`${name} has its own error: ${v.error}`);
    return v && typeof v === 'object' && 'value' in v ? v.value : v;
  };
};

/**
 * Evaluate a formula against named values.
 * @param {string|object} exprOrAst formula text (or an ast from parseFormula)
 * @param {Record<string, number|string|boolean|null|{value, error}>} variables alias → value
 * @returns {{ value: number|string|null, error: string|null }}
 */
export function evaluateFormula(exprOrAst, variables = {}) {
  let ast = exprOrAst;
  if (typeof exprOrAst === 'string' || exprOrAst == null) {
    const parsed = parseFormula(exprOrAst);
    if (parsed.error) return { value: null, error: parsed.error };
    ast = parsed.ast;
  }
  try {
    let value = evalNode(ast, buildLookup(variables));
    if (typeof value === 'boolean') value = value ? 1 : 0;
    if (typeof value === 'number' && !Number.isFinite(value)) return { value: null, error: 'The result is too large or not a number.' };
    return { value, error: null };
  } catch (e) {
    return { value: null, error: e instanceof FormulaError ? e.message : `Formula failed: ${e?.message || e}` };
  }
}

/**
 * Check a formula without real values: syntax, function usage and that every
 * referenced name is in availableAliases (case-insensitive).
 * @returns {{ ok: boolean, error: string|null, references: string[] }}
 */
export function validateFormula(expr, availableAliases = []) {
  if (!String(expr ?? '').trim()) return { ok: false, error: 'Enter a formula, e.g. Length * WtPerFt * Qty.', references: [] };
  const parsed = parseFormula(expr);
  if (parsed.error) return { ok: false, error: parsed.error, references: [] };
  const references = getFormulaReferences(expr);
  const known = new Set(availableAliases.map((a) => String(a).toLowerCase()));
  const unknown = references.filter((r) => !known.has(r.toLowerCase()));
  if (unknown.length) {
    return {
      ok: false,
      error: `Unknown column${unknown.length > 1 ? 's' : ''}: ${unknown.map((u) => `"${u}"`).join(', ')}. Available: ${availableAliases.join(', ') || '(none)'}.`,
      references,
    };
  }
  return { ok: true, error: null, references };
}

// --------------------------------------------------------------- self-check

/** Runs a fixed set of hand-checked cases. `node --input-type=module -e "import('./src/lib/takeoffFormula.js').then(m=>console.log(m.runFormulaSelfCheck()))"` */
export function runFormulaSelfCheck() {
  const vars = { Length: 20, WtPerFt: 35, Qty: 4, Grade: 'A992', Zero: 0, Flag: true };
  const cases = [
    // 20 * 35 * 4 / 2000 = 2800 / 2000 = 1.4
    ['Length * WtPerFt * Qty / 2000', 1.4],
    ['length*wtperft*QTY/2000', 1.4],
    ['2 + 3 * 4', 14],
    ['(2 + 3) * 4', 20],
    ['-2^2', -4],
    ['2^3^2', 512],
    ['10 − 4 × 2 ÷ 4', 8],
    ['-(3 - 5)', 2],
    ['ROUND(2 / 3, 2)', 0.67],
    ['ROUND(1.005, 2)', 1.01],
    ['ROUND(-2.5)', -3],
    ['CEILING(4.1)', 5],
    ['CEILING(41, 20)', 60],
    ['FLOOR(4.9)', 4],
    ['FLOOR(-1.5)', -2],
    ['MIN(3, 1, 2)', 1],
    ['MAX(Length, 25)', 25],
    ['ABS(-7.5)', 7.5],
    ['SQRT(9)', 3],
    ['IF(Length > 10, 1, 0)', 1],
    ['IF(Zero = 0, 5, 1 / Zero)', 5],
    ['IF(Grade = "a992", 50, 36)', 50],
    ['Grade & "-" & Qty', 'A992-4'],
    ['Length >= 20', 1],
    ['Length <> 20', 0],
    ['AND(Flag, Qty > 3)', 1],
    ['OR(0, Zero)', 0],
    ['NOT(Zero)', 1],
    ['TRUE + TRUE', 2],
    ['.5 + 1e1', 10.5],
  ];
  const errorCases = [
    ['Length / Zero', /Division by zero/],
    ['Lenght * 2', /Unknown column "Lenght"/],
    ['2 +', /ends too early/],
    ['(2 + 3', /Expected "\)"/],
    ['FOO(1)', /isn't a function/],
    ['ROUND()', /ROUND takes/],
    ['Grade * 2', /isn't a number/],
    ['2 $ 3', /isn't allowed/],
    ['', /empty/],
    ['SQRT(-1)', /negative/],
  ];
  const failures = [];
  let passed = 0;
  for (const [expr, expected] of cases) {
    const { value, error } = evaluateFormula(expr, vars);
    const ok = !error && (typeof expected === 'number' ? Math.abs(value - expected) < 1e-9 : value === expected);
    if (ok) passed += 1; else failures.push(`${expr} → ${error || value}, expected ${expected}`);
  }
  for (const [expr, pattern] of errorCases) {
    const { error } = evaluateFormula(expr, vars);
    if (error && pattern.test(error)) passed += 1; else failures.push(`${expr} → error "${error}", expected ${pattern}`);
  }
  const v1 = validateFormula('Length * WtPerFt', ['Length', 'WtPerFt']);
  const v2 = validateFormula('Length * Foo', ['Length']);
  if (v1.ok && !v2.ok && /Foo/.test(v2.error)) passed += 1; else failures.push('validateFormula');
  const refs = getFormulaReferences('IF(Qty > 0, length * LENGTH, [Wt Per Ft])');
  if (refs.join(',') === 'Qty,length,Wt Per Ft') passed += 1;
  else failures.push(`getFormulaReferences → ${refs.join(',')}`);
  return { passed, failed: failures.length, failures };
}
