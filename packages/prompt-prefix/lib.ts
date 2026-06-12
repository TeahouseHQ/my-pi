/**
 * Pure, testable helpers for the prompt-prefix package.
 */

/** Chevron shown at the start of the prompt input. Two visible columns. */
export const PROMPT_PREFIX = "> ";

/**
 * Overlay a prompt prefix onto an editor content line.
 *
 * The editor renders each content line with `prefixWidth` leading spaces (its
 * left padding). We swap those spaces for the styled prefix so the chevron sits
 * in the gutter without shifting any text or changing the line's visible width.
 *
 * If the line does not start with at least `prefixWidth` spaces (e.g. the editor
 * clamped its padding at a very small terminal width), the line is returned
 * untouched so we never corrupt borders or wrapped text.
 */
export function applyPromptPrefix(line: string, styledPrefix: string, prefixWidth: number): string {
	let spaces = 0;
	while (spaces < prefixWidth && line[spaces] === " ") spaces++;
	if (spaces < prefixWidth) return line;
	return styledPrefix + line.slice(prefixWidth);
}
