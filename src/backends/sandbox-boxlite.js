import { spawn, spawnSync } from 'node:child_process';
import { Backend } from './backend.js';

export class SandboxBoxliteBackend extends Backend {
  constructor({ bin = detectBoxliteBinary() } = {}) {
    super('sandbox');
    this.provider = 'boxlite';
    this.bin = bin;
  }

  static detectRuntime() {
    return detectBoxliteBinary();
  }

  health() {
    return {
      available: Boolean(this.bin),
      provider: this.provider,
      runtime: this.bin,
      reason: this.bin ? null : 'boxlite runtime not detected'
    };
  }

  async execute(segment, ctx = {}) {
    if (!this.bin) {
      return unavailableResult('boxlite runtime unavailable');
    }

    const timeoutMs = ctx.timeoutMs ?? 60000;
    const cwd = ctx.cwd || process.cwd();

    // boxlite CLI compatibility varies by version; this invocation assumes
    // a docker-like runner API with workspace bind mount and shell command.
    const args = [
      'run', '--rm',
      '--network', 'none',
      '--workdir', '/workspace',
      '--mount', `type=bind,src=${cwd},dst=/workspace,rw`,
      '--', 'sh', '-lc', segment
    ];

    return new Promise((resolve) => {
      const child = spawn(this.bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
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
          err.push(Buffer.from(`[error] timeout: command exceeded ${timeoutMs}ms limit\n`));
          resolve({ backend: this.name, exitCode: 124, stdout: Buffer.concat(out), stderr: Buffer.concat(err) });
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

function detectBoxliteBinary() {
  const r = spawnSync('boxlite', ['--version'], { encoding: 'utf8' });
  if (r.status === 0) return 'boxlite';
  return null;
}

function unavailableResult(reason) {
  return {
    backend: 'sandbox',
    exitCode: 125,
    stdout: Buffer.alloc(0),
    stderr: Buffer.from(`[error] sandbox backend unavailable: ${reason}\n`)
  };
}
