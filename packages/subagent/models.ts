/**
 * Model catalog helpers for subagent model overrides
 */

import { builtinModels } from "@earendil-works/pi-ai/providers/all";

export interface AvailableModels {
	/** Canonical "provider/id" references, sorted. */
	references: string[];
	/** Bare model ids that resolve unambiguously to a single provider. */
	unambiguousBareIds: Set<string>;
}

let cache: AvailableModels | undefined;

/** All models known to the built-in catalog, computed once per process. */
export function getAvailableModels(): AvailableModels {
	if (cache) return cache;

	const models = builtinModels().getModels();
	const byBareId = new Map<string, number>();
	for (const model of models) {
		byBareId.set(model.id, (byBareId.get(model.id) ?? 0) + 1);
	}

	cache = {
		references: models.map((m) => `${m.provider}/${m.id}`).sort(),
		unambiguousBareIds: new Set([...byBareId.entries()].filter(([, count]) => count === 1).map(([id]) => id)),
	};
	return cache;
}

export type ModelValidationResult = { ok: true } | { ok: false; error: string };

/**
 * Validate a model override string. Accepts either a canonical
 * "provider/model-id" reference or an unambiguous bare model id.
 */
export function validateModelOverride(model: string): ModelValidationResult {
	const available = getAvailableModels();

	if (model.includes("/") && available.references.includes(model)) return { ok: true };
	if (!model.includes("/") && available.unambiguousBareIds.has(model)) return { ok: true };

	return {
		ok: false,
		error:
			`Unknown model: "${model}". Available models: ${available.references.join(", ")}. ` +
			`Use the "provider/model-id" form.`,
	};
}
