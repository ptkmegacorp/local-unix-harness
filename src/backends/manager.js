import { parseChain } from '../parser.js';
import { classifyCommand } from '../policy.js';

export class BackendManager {
  constructor({ nativeBackend, sandboxBackend, classifier = classifyCommand } = {}) {
    this.native = nativeBackend;
    this.sandbox = sandboxBackend;
    this.classifier = classifier;
  }

  selectBackend(segment) {
    const cls = this.classifier(segment);
    // Class A read-only prefers native for supported, non-shell forms.
    if (cls === 'A' && this.native?.canHandle(segment)) {
      return { backend: this.native, policyClass: cls };
    }
    // Class B/C and unsupported A route through sandbox boundary.
    return { backend: this.sandbox, policyClass: cls };
  }

  async execute(command, cfg = {}) {
    const start = Date.now();
    const parsed = parseChain(command);
    const maxSegments = cfg.maxSegments ?? 12;
    if (parsed.segments.length > maxSegments) {
      return fail(`[error] chain too long: ${parsed.segments.length} segments (max ${maxSegments}). Split command and retry.`);
    }

    let prevExit = 0;
    let finalStdout = Buffer.alloc(0);
    let finalStderr = Buffer.alloc(0);
    const backendTrail = [];

    for (let i = 0; i < parsed.segments.length; i++) {
      const seg = parsed.segments[i];
      if (i > 0) {
        const op = parsed.ops[i - 1];
        if (op === '&&' && prevExit !== 0) continue;
        if (op === '||' && prevExit === 0) continue;
      }

      const { backend, policyClass } = this.selectBackend(seg);
      const result = await backend.execute(seg, {
        cwd: cfg.cwd,
        root: cfg.root,
        timeoutMs: cfg.timeoutMs
      });
      backendTrail.push({ segment: seg, backend: backend.name, policyClass });
      prevExit = result.exitCode;
      finalStdout = result.stdout;
      finalStderr = result.stderr;
    }

    return {
      ok: true,
      exitCode: prevExit,
      stdout: finalStdout,
      stderr: finalStderr,
      durationMs: Date.now() - start,
      backendTrail
    };
  }
}

function fail(stderr) {
  return { ok: false, exitCode: 1, stdout: Buffer.alloc(0), stderr: Buffer.from(stderr), durationMs: 0, backendTrail: [] };
}
