import { parseChain } from '../parser.js';
import { classifyCommand } from '../policy.js';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BUILTIN_BIN = fileURLToPath(new URL('../../bin', import.meta.url));

function isDomActSegment(seg) {
  return /^dom\s+/.test(seg) && /\bact\b/.test(seg);
}

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
      if (!backend) {
        return fail('[error] backend selection failed.');
      }
      if ((policyClass === 'B' || policyClass === 'C') && !this.sandbox?.isAvailable?.() && !isDomActSegment(seg)) {
        return fail('[error] sandbox backend unavailable: no supported runtime detected (boxlite, docker, podman). Install/enable a sandbox runtime and retry class B/C commands.');
      }

      const result = ((policyClass === 'A' && backend.name === 'sandbox' && !this.sandbox?.isAvailable?.()) ||
        (policyClass === 'B' && isDomActSegment(seg) && !this.sandbox?.isAvailable?.()))
        ? await executeClassAFallback(seg, cfg)
        : await backend.execute(seg, {
            cwd: cfg.cwd,
            root: cfg.root,
            timeoutMs: cfg.timeoutMs,
            llmEndpoints: cfg.llmEndpoints,
            llmModel: cfg.llmModel,
            llmDefaultModel: cfg.llmDefaultModel,
            llmToolsEnabled: cfg.llmToolsEnabled,
            llmTimeoutMs: cfg.llmTimeoutMs
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

async function executeClassAFallback(segment, cfg = {}) {
  const timeoutMs = cfg.timeoutMs ?? 60000;
  return new Promise((resolve) => {
    const env = { ...process.env };
    const pathParts = [BUILTIN_BIN];
    if (cfg.root) pathParts.push(`${cfg.root}/bin`);
    pathParts.push(env.PATH || '');
    env.PATH = pathParts.join(':');

    const child = spawn('bash', ['-c', segment], { cwd: cfg.cwd, env });
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
        resolve({ backend: 'native-fallback', exitCode: 124, stdout: Buffer.concat(out), stderr: Buffer.concat(err) });
        return;
      }
      resolve({ backend: 'native-fallback', exitCode: code ?? 1, stdout: Buffer.concat(out), stderr: Buffer.concat(err) });
    });

    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ backend: 'native-fallback', exitCode: 127, stdout: Buffer.alloc(0), stderr: Buffer.from(String(e.message)) });
    });
  });
}
