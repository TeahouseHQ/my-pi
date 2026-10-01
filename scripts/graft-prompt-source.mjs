const original = '.map((n) => `- id=${n.id} | ${n.kind} | lines L${n.startLine}-L${n.endLine}` +\n        (n.signature ? ` | ${n.signature}` : ""))';
const replacement = '.map((n) => JSON.stringify({ id: n.id, kind: n.kind, lines: `L${n.startLine}-L${n.endLine}`, signature: n.signature || undefined }))';

export function rewriteCruxPrompt(source) {
  if (source.split(original).length !== 2) {
    throw new Error('Unsupported graft crux prompt format; update the project prompt adapter.');
  }
  return source.replace(original, replacement);
}
