import { BackendManager } from './backends/manager.js';
import { NativeBackend } from './backends/native.js';
import { SandboxBackend } from './backends/sandbox.js';

const manager = new BackendManager({
  nativeBackend: new NativeBackend(),
  sandboxBackend: new SandboxBackend()
});

export async function executeChain(command, cfg = {}) {
  return manager.execute(command, cfg);
}

export function getBackendManager() {
  return manager;
}
