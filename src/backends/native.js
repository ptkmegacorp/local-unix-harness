import { Backend } from './backend.js';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const NATIVE_COMMANDS = new Set(['echo', 'pwd', 'true', 'false', 'cat', 'ls']);
const UNSAFE_META = /[|><`$(){}\[*?]/;

export class NativeBackend extends Backend {
  constructor() {
    super('native');
  }

  canHandle(segment) {
    if (!segment || UNSAFE_META.test(segment)) return false;
    const argv = tokenize(segment);
    if (argv.length === 0) return false;
    return NATIVE_COMMANDS.has(argv[0]);
  }

  async execute(segment, ctx = {}) {
    const argv = tokenize(segment);
    if (argv.length === 0) {
      return { backend: this.name, exitCode: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    }
    const cmd = argv[0];
    const args = argv.slice(1);

    switch (cmd) {
      case 'echo':
        return ok(Buffer.from(`${args.join(' ')}\n`));
      case 'pwd':
        return ok(Buffer.from(`${ctx.cwd || process.cwd()}\n`));
      case 'true':
        return ok();
      case 'false':
        return fail(1);
      case 'cat':
        return this.execCat(args, ctx);
      case 'ls':
        return this.execLs(args, ctx);
      default:
        return notFound(cmd);
    }
  }

  execCat(args, ctx) {
    if (args.length === 0) return ok();
    const chunks = [];
    for (const p of args) {
      const abs = resolve(ctx.cwd || process.cwd(), p);
      if (!existsSync(abs)) {
        return { backend: this.name, exitCode: 1, stdout: Buffer.alloc(0), stderr: Buffer.from(`cat: ${p}: No such file or directory\n`) };
      }
      chunks.push(readFileSync(abs));
    }
    return ok(Buffer.concat(chunks));
  }

  execLs(args, ctx) {
    const target = args[0] || '.';
    const abs = resolve(ctx.cwd || process.cwd(), target);
    if (!existsSync(abs)) {
      return { backend: this.name, exitCode: 2, stdout: Buffer.alloc(0), stderr: Buffer.from(`ls: cannot access '${target}': No such file or directory\n`) };
    }
    const st = lstatSync(abs);
    if (!st.isDirectory()) return ok(Buffer.from(`${target}\n`));
    const items = readdirSync(abs).sort();
    return ok(Buffer.from(items.join('\n') + (items.length ? '\n' : '')));
  }
}

function tokenize(input) {
  const out = [];
  let buf = '';
  let q = null;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (q) {
      if (ch === q) {
        q = null;
      } else if (ch === '\\' && q === '"' && i + 1 < input.length) {
        buf += input[++i];
      } else {
        buf += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      q = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (buf) {
        out.push(buf);
        buf = '';
      }
      continue;
    }
    buf += ch;
  }
  if (buf) out.push(buf);
  return out;
}

function ok(stdout = Buffer.alloc(0)) {
  return { backend: 'native', exitCode: 0, stdout, stderr: Buffer.alloc(0) };
}

function fail(code) {
  return { backend: 'native', exitCode: code, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
}

function notFound(cmd) {
  return { backend: 'native', exitCode: 127, stdout: Buffer.alloc(0), stderr: Buffer.from(`bash: ${cmd}: command not found\n`) };
}
