import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Backend } from './backend.js';

const BUILTIN_BIN = fileURLToPath(new URL('../../bin', import.meta.url));

export class SandboxBackend extends Backend {
  constructor() {
    super('sandbox');
  }

  canHandle() {
    return true;
  }

  async execute(segment, ctx = {}) {
    const timeoutMs = ctx.timeoutMs ?? 60000;
    return new Promise((resolve) => {
      const env = { ...process.env };
      const pathParts = [BUILTIN_BIN];
      if (ctx.root) pathParts.push(`${ctx.root}/bin`);
      pathParts.push(env.PATH || '');
      env.PATH = pathParts.join(':');

      const child = spawn('bash', ['-c', segment], { cwd: ctx.cwd, env });
      const out = [];
      const err = [];
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);

      child.stdout.on('data', (d) => out.push(Buffer.from(d)));
      child.stderr.on('data', (d) => err.push(Buffer.from(d)));

      child.on('close', (code) => {
        clearTimeout(timer);
        if (timedOut) {
          const e = Buffer.from(`[error] timeout: command exceeded ${timeoutMs}ms limit\n`);
          resolve({ backend: this.name, exitCode: 124, stdout: Buffer.concat(out), stderr: Buffer.concat([...err, e]) });
          return;
        }
        resolve({ backend: this.name, exitCode: code ?? 1, stdout: Buffer.concat(out), stderr: Buffer.concat(err) });
      });

      child.on('error', (e) => {
        clearTimeout(timer);
        resolve({ backend: this.name, exitCode: 127, stdout: Buffer.alloc(0), stderr: Buffer.from(String(e.message)) });
      });
    });
  }
}

// TODO: swap bash execution with a VM-backed sandbox (boxlite/firecracker)
// while preserving this backend boundary and return contract.
