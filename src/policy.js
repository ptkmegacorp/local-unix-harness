const READ_ONLY = ['cat', 'ls', 'grep', 'mgrep', 'find', 'head', 'tail', 'wc', 'jq', 'echo', 'printf', 'true', 'false', 'pwd', 'whoami', 'cut', 'sort', 'uniq', 'sed', 'awk', 'stat', 'file', 'env'];
const DESTRUCTIVE = ['rm', 'shutdown', 'reboot', 'mkfs', 'dd', 'systemctl', 'service', 'iptables', 'ufw'];
const EXTERNAL = ['curl', 'wget', 'scp', 'ssh', 'nc', 'telnet', 'mail', 'sendmail'];
const WRITE_HINTS = ['>', '>>', 'tee', 'mv', 'cp', 'mkdir', 'touch'];

export function classifyCommand(command) {
  const segments = command
    .split(/&&|\|\||;/)
    .map((s) => s.trim())
    .filter(Boolean);

  let sawB = false;
  for (const seg of segments.length ? segments : [command]) {
    const first = seg.split(/\s+/)[0] || '';
    if (DESTRUCTIVE.includes(first) || EXTERNAL.includes(first)) return 'C';
    if (WRITE_HINTS.some((w) => seg.includes(w))) {
      sawB = true;
      continue;
    }
    if (!READ_ONLY.includes(first)) sawB = true;
  }

  return sawB ? 'B' : 'A';
}

export function enforcePolicy(command, options = {}) {
  const policyClass = classifyCommand(command);
  const sure = Boolean(options.confirmSure);

  if (policyClass === 'B') {
    if (!options.confirmWrite) {
      return refusal('Mutable command blocked', 'Set confirmWrite=true and retry.');
    }
  }

  if (policyClass === 'C') {
    const isDelete = /(^|\s)rm(\s|$)/.test(command);
    const isExternal = EXTERNAL.some((e) => new RegExp(`(^|\\s)${e}(\\s|$)`).test(command));
    if (isDelete && !options.confirmDelete) {
      return refusal('Destructive command blocked', 'Set confirmDelete=true and retry.');
    }
    if (isExternal && !options.confirmExternalSend) {
      return refusal('External command blocked', 'Set confirmExternalSend=true and retry.');
    }
    if (!sure) {
      return refusal('Second confirmation required', 'Set confirmSure=true ("are you sure") and retry.');
    }
  }
  return { ok: true, policyClass };
}

function refusal(reason, next) {
  return {
    ok: false,
    error: `[error] ${reason}. ${next}`,
    policyClass: 'C'
  };
}
