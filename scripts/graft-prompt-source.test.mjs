import { describe, expect, it } from 'vitest';
import { rewriteCruxPrompt } from './graft-prompt-source.mjs';

const original = '.map((n) => `- id=${n.id} | ${n.kind} | lines L${n.startLine}-L${n.endLine}` +\n        (n.signature ? ` | ${n.signature}` : ""))';

describe('graft deep prompt adapter', () => {
  it('separates the ID from its metadata', () => {
    const updated = rewriteCruxPrompt(original);
    expect(updated).toContain('JSON.stringify({ id: n.id, kind: n.kind, lines:');
    expect(updated).toContain('signature: n.signature || undefined');
    expect(updated).not.toContain(original);
  });

  it('rejects an unknown or ambiguous upstream prompt format', () => {
    expect(() => rewriteCruxPrompt('unrelated prompt')).toThrow('Unsupported graft crux prompt format');
    expect(() => rewriteCruxPrompt(`${original}\n${original}`)).toThrow('Unsupported graft crux prompt format');
  });
});
