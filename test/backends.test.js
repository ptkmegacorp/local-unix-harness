import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BackendManager } from '../src/backends/manager.js';
import { NativeBackend } from '../src/backends/native.js';
import { SandboxBackend } from '../src/backends/sandbox.js';
import { run } from '../src/run.js';
import { getConfig } from '../src/config.js';

function cfgFor(dir) {
  process.env.HARNESS_ROOT = dir;
  process.env.HARNESS_CWD = dir;
  process.env.HARNESS_USE_LLM_PRESENTER = '0';
  return getConfig();
}

test('backend selection correctness by class/support', () => {
  const manager = new BackendManager({ nativeBackend: new NativeBackend(), sandboxBackend: new SandboxBackend() });
  assert.equal(manager.selectBackend('cat a.txt').backend.name, 'native'); // class A + supported
  assert.equal(manager.selectBackend('touch a.txt').backend.name, 'sandbox'); // class B
  assert.equal(manager.selectBackend('curl https://example.com').backend.name, 'sandbox'); // class C
  assert.equal(manager.selectBackend('grep x a.txt | wc -l').backend.name, 'sandbox'); // class A but shell form unsupported natively
});

test('native backend path executes read-only commands', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'harness-native-'));
  writeFileSync(join(dir, 'a.txt'), 'hello\n');
  const manager = new BackendManager({ nativeBackend: new NativeBackend(), sandboxBackend: new SandboxBackend() });
  const r = await manager.execute('cat a.txt', { cwd: dir, root: dir, timeoutMs: 2000 });
  assert.equal(r.exitCode, 0);
  assert.equal(r.backendTrail[0].backend, 'native');
  assert.equal(r.stdout.toString('utf8'), 'hello\n');
  rmSync(dir, { recursive: true, force: true });
});

test('sandbox backend unavailable returns deterministic error for class B/C', async () => {
  const manager = new BackendManager({
    nativeBackend: new NativeBackend(),
    sandboxBackend: { name: 'sandbox', canHandle: () => true, isAvailable: () => false, execute: async () => ({ exitCode: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }) }
  });

  const b = await manager.execute('touch made-by-sandbox.txt', { timeoutMs: 2000 });
  assert.equal(b.ok, false);
  assert.match(b.stderr.toString('utf8'), /sandbox backend unavailable/i);

  const c = await manager.execute('curl --version', { timeoutMs: 2000 });
  assert.equal(c.ok, false);
  assert.match(c.stderr.toString('utf8'), /sandbox backend unavailable/i);
});

test('sandbox runtime detection selection metadata', () => {
  const sandbox = new SandboxBackend();
  const health = sandbox.health();
  assert.ok(Object.hasOwn(health, 'available'));
  assert.ok(Object.hasOwn(health, 'provider'));
  if (!health.available) {
    assert.match(health.initError || '', /runtime available/i);
  }
});

test('sandbox backend path executes command when runtime available', { skip: !new SandboxBackend().isAvailable() }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'harness-sandbox-'));
  const manager = new BackendManager({ nativeBackend: new NativeBackend(), sandboxBackend: new SandboxBackend() });

  const b = await manager.execute('sh -lc "echo sandbox-ok"', { cwd: dir, root: dir, timeoutMs: 8000 });
  assert.equal(b.backendTrail[0].backend, 'sandbox');
  assert.equal(b.exitCode, 0);
  assert.match(b.stdout.toString('utf8'), /sandbox-ok/);
  rmSync(dir, { recursive: true, force: true });
});

test('run(command) output format regression', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'harness-run-format-'));
  const cfg = cfgFor(dir);
  const r = await run('echo ok', cfg);
  assert.equal(r.ok, true);
  assert.equal(r.exitCode, 0);
  assert.match(r.output, /^ok\n\n\[exit:0 \| \d+ms\]$/);
  rmSync(dir, { recursive: true, force: true });
});
