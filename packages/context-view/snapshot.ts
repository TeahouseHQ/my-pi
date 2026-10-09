/**
 * Context snapshot — assembles what the LLM currently receives.
 *
 * A snapshot is a live reconstruction ("what would be sent next turn"), never
 * a capture of the exact last-sent payload (see GLOSSARY.md, "Snapshot"). The
 * assembly is pure: `buildSnapshot` takes already-extracted inputs, so the
 * pi-facing adaptation lives in index.ts and everything here is testable.
 *
 * One zone, three sections, in dispatch order:
 *   1. System prompt  — decomposed into the structured inputs pi built it from
 *  2. Tool schemas    — the provider's separate tools parameter
 *   3. Messages       — the compaction-aware branch messages
 *
 * Token figures are estimates (chars÷4, `estimateTokens`) and always labeled
 * as such. The system prompt breakdown attributes sizes to inputs; the
 * composed prompt's total is authoritative and the difference is shown as an
 * explicit "framing & assembly" reconciliation entry.
 */

import { estimateTokens } from "@earendil-works/pi-coding-agent";

/** Structured inputs pi used to compose the system prompt (subset we render). */
export interface SystemPromptInputs {
	customPrompt?: string;
	toolSnippets?: Record<string, string>;
	promptGuidelines?: string[];
	appendSystemPrompt?: string;
	contextFiles?: Array<{ path: string; content: string }>;
	skills?: Array<{ name: string; description: string; disableModelInvocation: boolean }>;
}

/** One active tool's schema-bearing info, as the provider receives it. */
export interface ActiveToolInfo {
	name: string;
	description?: string;
	parameters?: unknown;
	/** Where the tool came from (e.g. "core", an extension path). */
	sourceLabel?: string;
}

export interface UsageInfo {
	tokens: number | null;
	percent: number | null;
	contextWindow: number;
}

/** The exact message type `estimateTokens` accepts. */
type AnyMessage = Parameters<typeof estimateTokens>[0];

/** Structural view of a message — everything rendering needs, without the full union. */
export interface MessageLike {
	role?: unknown;
	content?: unknown;
}

export interface SnapshotEntry {
	/** Stable id within one snapshot, used for expand/collapse. */
	id: string;
	label: string;
	preview: string;
	/** Estimated tokens; `null` when the entry carries no token weight. */
	tokens: number | null;
	/** Whether the entry's tokens are part of its section's total. */
	counted: boolean;
	/** Marker line, e.g. for skills loaded but withheld from the prompt. */
	flag?: string;
	/** Lines shown when the entry is expanded (already line-capped). */
	body?: string[];
}

export interface SnapshotSection {
	id: string;
	title: string;
	/** Authoritative section total (sum of entries where the breakdown is approximate). */
	tokens: number;
	entries: SnapshotEntry[];
	footnote?: string;
}

export interface ContextSnapshot {
	sections: SnapshotSection[];
	/** Sum of section totals. */
	totalTokens: number;
	usage: UsageInfo | undefined;
	assembledAt: Date;
}

/** Max rendered lines per expanded entry body — huge content gets a tail marker. */
const MAX_BODY_LINES = 400;
const PREVIEW_CHARS = 100;

/** chars÷4, mirroring pi's `estimateTokens` heuristic, for raw strings. */
export function estimateString(text: string): number {
	return Math.ceil(text.length / 4);
}

/** Token formatting matching the footer's `fmtTokens` (parts stay decoupled). */
export function fmtEst(tokens: number): string {
	if (tokens < 1_000) return String(tokens);
	if (tokens < 1_000_000) return `${(tokens / 1_000).toFixed(1)}k`;
	return `${(tokens / 1_000_000).toFixed(2)}M`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/** One content block → readable line(s). Unknown block shapes degrade visibly. */
function blockLines(block: unknown): string[] {
	if (!isRecord(block)) return [String(block)];
	switch (block.type) {
		case "text":
			return typeof block.text === "string" ? block.text.split("\n") : [];
		case "thinking":
			return typeof block.thinking === "string"
				? block.thinking.split("\n").map((line) => `[thinking] ${line}`)
				: ["[thinking]"];
		case "toolCall": {
			const name = typeof block.name === "string" ? block.name : "tool";
			const args = "arguments" in block && block.arguments !== undefined ? JSON.stringify(block.arguments) : "";
			return [`→ ${name}(${args})`];
		}
		case "image": {
			const mime = typeof block.mimeType === "string" ? block.mimeType : "image";
			const size = typeof block.data === "string" ? ` · ${block.data.length} b64 chars` : "";
			return [`[image ${mime}${size}]`];
		}
		default:
			return [`[${typeof block.type === "string" ? block.type : "unknown block"}]`];
	}
}

/** Message → readable lines (text, thinking, tool calls, image placeholders). */
export function messageLines(message: MessageLike): string[] {
	if (typeof message.content === "string") return message.content.split("\n");
	if (Array.isArray(message.content)) return message.content.flatMap(blockLines);
	return ["[unrenderable content]"];
}
/** First non-empty line, truncated for a collapsed row. */
function previewOf(message: MessageLike): string {
	const line = messageLines(message).find((l) => l.trim().length > 0) ?? "";
	return line.length > PREVIEW_CHARS ? `${line.slice(0, PREVIEW_CHARS - 1)}…` : line;
}

/** Cap expanded bodies so one huge tool result can't stall rendering. */
function capBody(lines: string[]): string[] {
	if (lines.length <= MAX_BODY_LINES) return lines;
	return [...lines.slice(0, MAX_BODY_LINES), `… +${lines.length - MAX_BODY_LINES} more lines`];
}

function firstLine(text: string): string {
	return text.split("\n")[0] ?? "";
}

export function buildSnapshot(input: {
	systemPrompt: string;
	inputs: SystemPromptInputs;
	activeTools: ActiveToolInfo[];
	messages: MessageLike[];
	usage: UsageInfo | undefined;
}): ContextSnapshot {
	const sections: SnapshotSection[] = [
		buildSystemPromptSection(input.systemPrompt, input.inputs),
		buildToolSection(input.activeTools),
		buildMessageSection(input.messages),
	];
	return {
		sections,
		totalTokens: sections.reduce((sum, s) => sum + s.tokens, 0),
		usage: input.usage,
		assembledAt: new Date(),
	};
}

function buildSystemPromptSection(promptText: string, inputs: SystemPromptInputs): SnapshotSection {
	const total = estimateString(promptText);
	const entries: SnapshotEntry[] = [];
	let countedSum = 0;
	const push = (entry: SnapshotEntry) => {
		entries.push(entry);
		if (entry.counted && entry.tokens != null) countedSum += entry.tokens;
	};

	if (inputs.customPrompt !== undefined) {
		push({
			id: "sys:custom",
			label: "custom prompt",
			preview: firstLine(inputs.customPrompt).slice(0, PREVIEW_CHARS),
			tokens: estimateString(inputs.customPrompt),
			counted: true,
			flag: "replaces pi's default prompt",
			body: capBody(inputs.customPrompt.split("\n")),
		});
	}

	for (const [i, file] of (inputs.contextFiles ?? []).entries()) {
		const lines = file.content.split("\n");
		push({
			id: `sys:file:${i}`,
			label: file.path,
			preview: firstLine(file.content).slice(0, PREVIEW_CHARS),
			tokens: estimateString(file.content),
			counted: true,
			body: capBody(lines),
		});
	}

	const snippets = Object.entries(inputs.toolSnippets ?? {});
	if (snippets.length > 0) {
		push({
			id: "sys:snippets",
			label: "tool snippets",
			preview: `${snippets.length} one-line snippet${snippets.length === 1 ? "" : "s"}`,
			tokens: estimateString(snippets.map(([name, text]) => `${name}: ${text}`).join("\n")),
			counted: true,
			body: capBody(snippets.map(([name, text]) => `${name}: ${text}`)),
		});
	}

	const guidelines = inputs.promptGuidelines ?? [];
	if (guidelines.length > 0) {
		push({
			id: "sys:guidelines",
			label: "guidelines",
			preview: `${guidelines.length} bullet${guidelines.length === 1 ? "" : "s"}`,
			tokens: estimateString(guidelines.join("\n")),
			counted: true,
			body: capBody(guidelines.map((g) => `- ${g}`)),
		});
	}

	for (const [i, skill] of (inputs.skills ?? []).entries()) {
		const withheld = skill.disableModelInvocation;
		const text = `<skill>${skill.name} — ${skill.description}</skill>`;
		push({
			id: `sys:skill:${i}`,
			label: skill.name,
			preview: skill.description.slice(0, PREVIEW_CHARS),
			tokens: withheld ? null : estimateString(text),
			counted: !withheld,
			flag: withheld ? "loaded but withheld from the prompt (disableModelInvocation)" : undefined,
		});
	}

	if (inputs.appendSystemPrompt !== undefined && inputs.appendSystemPrompt.length > 0) {
		push({
			id: "sys:append",
			label: "appended prompt",
			preview: firstLine(inputs.appendSystemPrompt).slice(0, PREVIEW_CHARS),
			tokens: estimateString(inputs.appendSystemPrompt),
			counted: true,
			body: capBody(inputs.appendSystemPrompt.split("\n")),
		});
	}

	// Reconciliation: the composed prompt is authoritative; whatever the input
	// breakdown doesn't account for (pi's default prompt, framing, separators)
	// is shown explicitly instead of silently absorbed.
	const remainder = total - countedSum;
	push({
		id: "sys:remainder",
		label: inputs.customPrompt !== undefined ? "framing & assembly" : "pi default prompt, framing & assembly",
		preview: "",
		tokens: remainder,
		counted: true,
	});

	return {
		id: "sec:system",
		title: "System prompt",
		tokens: total,
		entries,
		footnote: "breakdown is approximate — the section total is the composed prompt",
	};
}

function buildToolSection(tools: ActiveToolInfo[]): SnapshotSection {
	const entries = tools.map((tool, i) => {
		const schema = JSON.stringify({ name: tool.name, description: tool.description, parameters: tool.parameters });
		return {
			id: `tool:${i}`,
			label: tool.name,
			preview: tool.sourceLabel ?? "",
			tokens: estimateString(schema),
			counted: true,
		};
	});
	return {
		id: "sec:tools",
		title: "Tool schemas",
		tokens: entries.reduce((sum, e) => sum + (e.tokens ?? 0), 0),
		entries,
		footnote: "schemas ride in a separate provider parameter, outside the system prompt",
	};
}

function buildMessageSection(messages: MessageLike[]): SnapshotSection {
	const entries = messages.map((message, i) => ({
		id: `msg:${i}`,
		label: String(message.role ?? "unknown"),
		preview: previewOf(message),
		tokens: estimateTokens(message as AnyMessage),
		counted: true,
		body: capBody(messageLines(message)),
	}));
	return {
		id: "sec:messages",
		title: "Messages",
		tokens: entries.reduce((sum, e) => sum + (e.tokens ?? 0), 0),
		entries,
		footnote: "reconstructed from the session branch — what would be sent next turn",
	};
}

/** One-line summary for the non-TUI `notify()` fallback. */
export function formatCompactSummary(snapshot: ContextSnapshot): string {
	const usage = snapshot.usage
		? `provider ${snapshot.usage.tokens == null ? "unknown" : fmtEst(snapshot.usage.tokens)}${snapshot.usage.percent != null ? ` (${snapshot.usage.percent}%)` : ""}`
		: "provider usage unknown";
	const parts = snapshot.sections.map((s) => `${s.title.toLowerCase()} ${fmtEst(s.tokens)}`);
	return `context (est) ~${fmtEst(snapshot.totalTokens)} tok · ${usage} · ${parts.join(" · ")}`;
}
