import { Backend } from './backend.js';
import { SandboxBoxliteBackend } from './sandbox-boxlite.js';
import { SandboxDockerBackend } from './sandbox-docker.js';

export class SandboxBackend extends Backend {
  constructor(opts = {}) {
    super('sandbox');
    this.preferredProvider = opts.preferredProvider || process.env.HARNESS_SANDBOX_PROVIDER || 'auto';
    this.provider = null;
    this.impl = null;
    this.initError = null;

    this.selectProvider();
  }

  canHandle() {
    return true;
  }

  isAvailable() {
    return Boolean(this.impl);
  }

  health() {
    return {
      available: this.isAvailable(),
      provider: this.provider,
      preferredProvider: this.preferredProvider,
      initError: this.initError,
      ...(this.impl?.health?.() || {})
    };
  }

  selectProvider() {
    const order = [];
    if (this.preferredProvider === 'boxlite') order.push('boxlite');
    else if (this.preferredProvider === 'docker') order.push('docker');
    else if (this.preferredProvider === 'podman') order.push('docker');
    else order.push('boxlite', 'docker');

    for (const p of order) {
      if (p === 'boxlite') {
        const impl = new SandboxBoxliteBackend();
        if (impl.health().available) {
          this.provider = 'boxlite';
          this.impl = impl;
          return;
        }
      }

      if (p === 'docker') {
        const impl = new SandboxDockerBackend();
        if (impl.health().available) {
          this.provider = impl.runtime;
          this.impl = impl;
          return;
        }
      }
    }

    this.provider = null;
    this.impl = null;
    this.initError = 'no sandbox runtime available (boxlite, docker, podman)';
  }

  async execute(segment, ctx = {}) {
    if (!this.impl) {
      return {
        backend: this.name,
        exitCode: 125,
        stdout: Buffer.alloc(0),
        stderr: Buffer.from(`[error] sandbox backend unavailable: ${this.initError}\n`)
      };
    }
    return this.impl.execute(segment, ctx);
  }
}
