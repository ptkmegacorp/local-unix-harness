import { spawn, spawnSync } from 'node:child_process';
import { Backend } from './backend.js';

const DEFAULT_IMAGE = process.env.HARNESS_SANDBOX_IMAGE || 'debian:bookworm-slim';

export class SandboxDockerBackend extends Backend {
  constructor({ runtime = detectContainerRuntime(), image = DEFAULT_IMAGE } = {}) {
    super('sandbox');
    this.provider = 'docker';
    this.runtime = runtime;
    this.image = image;
  }

  static detectRuntime() {
    return detectContainerRuntime();
  }

  health() {
    return {
      available: Boolean(this.runtime),
      provider: this.provider,
      runtime: this.runtime,
      image: this.image,
      reason: this.runtime ? null : 'docker/podman runtime not detected'
    };
  }

  async execute(segment, ctx = {}) {
    if (!this.runtime) {
      return unavailableResult('container runtime unavailable');
    }
    const timeoutMs = ctx.timeoutMs ?? 60000;
    const cwd = ctx.cwd || process.cwd();

    const args = [
      'run', '--rm', '--interactive',
      '--network', 'none',
      '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges',
      '--pids-limit', '256',
      '--memory', '512m',
      '--cpus', '1',
      '--workdir', '/workspace',
      '--mount', `type=bind,src=${cwd},dst=/workspace,rw`,
      this.image,
      'sh', '-lc', segment
    ];

    return new Promise((resolve) => {
      const child = spawn(this.runtime, args, { stdio: ['ignore', 'pipe', 'pipe'] });
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

function detectContainerRuntime() {
  for (const bin of ['docker', 'podman']) {
    const r = spawnSync(bin, ['--version'], { encoding: 'utf8' });
    if (r.status === 0) return bin;
  }
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
