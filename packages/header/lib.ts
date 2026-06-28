/**
 * Pure, testable helpers for the header's loaded-resource sections.
 *
 * These reproduce Pi's built-in "[Context] / [Skills] / [Extensions]" startup
 * listing (the compact, one-line-per-section form). The logic is ported from
 * Pi's interactive-mode `showLoadedResources()` so labels match what the
 * built-in header prints.
 */

import os from "node:os";
import path from "node:path";
import type { SourceInfo } from "@earendil-works/pi-coding-agent";

/** Minimal shape we need from a loaded resource (extension/skill/etc.). */
export interface ResourceRef {
	path: string;
	sourceInfo?: SourceInfo;
}

/** Replace a leading home directory with `~`. */
export function formatDisplayPath(p: string, home: string = os.homedir()): string {
	if (home && p.startsWith(home)) {
		return `~${p.slice(home.length)}`;
	}
	return p;
}

/**
 * Format a context-file path the way Pi does: relative to cwd when inside it,
 * otherwise a `~`-shortened absolute path. Always uses forward slashes.
 */
export function formatContextPath(p: string, cwd: string): string {
	const resolvedCwd = path.resolve(cwd);
	const absolutePath = path.isAbsolute(p) ? path.resolve(p) : path.resolve(resolvedCwd, p);
	const relativePath = path.relative(resolvedCwd, absolutePath);
	const isInsideCwd =
		relativePath === "" ||
		(relativePath !== ".." && !relativePath.startsWith(`..${path.sep}`) && !path.isAbsolute(relativePath));
	if (isInsideCwd) {
		return (relativePath || ".").split(path.sep).join("/");
	}
	return formatDisplayPath(absolutePath);
}

/** True when a resource comes from an installed package (npm or git). */
export function isPackageSource(sourceInfo?: SourceInfo): boolean {
	const source = sourceInfo?.source ?? "";
	return source.startsWith("npm:") || source.startsWith("git:");
}

/** Best-effort "user/project" extraction from a git source string. */
function parseGitPath(source: string): string {
	let s = source.startsWith("git:") ? source.slice(4) : source;
	s = s
		.trim()
		.replace(/#.*$/, "")
		.replace(/\.git$/, "")
		.replace(/^(https?|ssh|git):\/\//i, "")
		.replace(/^git@/, "")
		.replace(/:/g, "/");
	const segments = s.split("/").filter(Boolean);
	return segments.length >= 2 ? segments.slice(-2).join("/") : s;
}

/** Short path relative to a package root (or `~`-shortened) for display. */
export function getShortPath(fullPath: string, sourceInfo?: SourceInfo): string {
	const baseDir = sourceInfo?.baseDir;
	if (baseDir && isPackageSource(sourceInfo)) {
		const relativePath = path.relative(path.resolve(baseDir), path.resolve(fullPath));
		if (
			relativePath &&
			relativePath !== "." &&
			!relativePath.startsWith("..") &&
			!relativePath.startsWith(`..${path.sep}`) &&
			!path.isAbsolute(relativePath)
		) {
			return relativePath.replace(/\\/g, "/");
		}
	}
	const source = sourceInfo?.source ?? "";
	const npmMatch = fullPath.match(/node_modules\/(@?[^/]+(?:\/[^/]+)?)\/(.*)/);
	if (npmMatch && source.startsWith("npm:")) {
		return npmMatch[2];
	}
	const gitMatch = fullPath.match(/git\/[^/]+\/[^/]+\/(.*)/);
	if (gitMatch && source.startsWith("git:")) {
		return gitMatch[1];
	}
	return formatDisplayPath(fullPath);
}

/** Last meaningful path segment of a resource. */
export function getCompactPathLabel(resourcePath: string, sourceInfo?: SourceInfo): string {
	const shortPath = getShortPath(resourcePath, sourceInfo);
	const normalizedPath = shortPath.replace(/\\/g, "/");
	const segments = normalizedPath.split("/").filter((segment) => segment.length > 0 && segment !== "~");
	return segments.length > 0 ? segments[segments.length - 1] : shortPath;
}

function getCompactPackageSourceLabel(sourceInfo?: SourceInfo): string {
	const source = sourceInfo?.source ?? "";
	if (source.startsWith("npm:")) {
		return source.slice("npm:".length) || source;
	}
	if (source.startsWith("git:")) {
		return parseGitPath(source) || source;
	}
	return source;
}

function getCompactDisplayPathSegments(resourcePath: string): string[] {
	return formatDisplayPath(resourcePath)
		.replace(/\\/g, "/")
		.split("/")
		.filter((segment) => segment.length > 0 && segment !== "~");
}

function getCompactExtensionLabel(resourcePath: string, sourceInfo?: SourceInfo): string {
	if (!isPackageSource(sourceInfo)) {
		return getCompactPathLabel(resourcePath, sourceInfo);
	}
	const sourceLabel = getCompactPackageSourceLabel(sourceInfo);
	if (!sourceLabel) {
		return getCompactPathLabel(resourcePath, sourceInfo);
	}
	const shortPath = getShortPath(resourcePath, sourceInfo).replace(/\\/g, "/");
	const packagePath = shortPath.startsWith("extensions/") ? shortPath.slice("extensions/".length) : shortPath;
	const parsedPath = path.posix.parse(packagePath);
	if (parsedPath.name === "index") {
		return !parsedPath.dir || parsedPath.dir === "." ? sourceLabel : `${sourceLabel}:${parsedPath.dir}`;
	}
	return `${sourceLabel}:${packagePath}`;
}

function getCompactNonPackageExtensionLabel(
	resourcePath: string,
	index: number,
	allPaths: Array<{ path: string; segments: string[] }>,
): string {
	const segments = allPaths[index]?.segments;
	if (!segments || segments.length === 0) {
		return getCompactPathLabel(resourcePath);
	}
	for (let segmentCount = 1; segmentCount <= segments.length; segmentCount += 1) {
		const candidate = segments.slice(-segmentCount).join("/");
		const isUnique = allPaths.every((item, itemIndex) => {
			if (itemIndex === index) {
				return true;
			}
			return item.segments.slice(-segmentCount).join("/") !== candidate;
		});
		if (isUnique) {
			return candidate;
		}
	}
	return segments.join("/");
}

/**
 * Compact labels for loaded extensions, matching Pi's `[Extensions]` listing.
 * Package extensions collapse to `source[:subpath]`; local extensions use the
 * shortest unique trailing path segment(s).
 */
export function getCompactExtensionLabels(extensions: ResourceRef[]): string[] {
	const nonPackageExtensions = extensions
		.map((extension) => {
			const segments = getCompactDisplayPathSegments(extension.path);
			const lastSegment = segments[segments.length - 1];
			if (segments.length > 1 && (lastSegment === "index.ts" || lastSegment === "index.js")) {
				segments.pop();
			}
			return { path: extension.path, sourceInfo: extension.sourceInfo, segments };
		})
		.filter((extension) => !isPackageSource(extension.sourceInfo));

	return extensions.map((extension) => {
		if (isPackageSource(extension.sourceInfo)) {
			return getCompactExtensionLabel(extension.path, extension.sourceInfo);
		}
		const nonPackageIndex = nonPackageExtensions.findIndex((item) => item.path === extension.path);
		if (nonPackageIndex === -1) {
			return getCompactPathLabel(extension.path, extension.sourceInfo);
		}
		return getCompactNonPackageExtensionLabel(extension.path, nonPackageIndex, nonPackageExtensions);
	});
}

/** Trim, drop empties, and (by default) sort labels — mirrors Pi's compact list. */
export function compactList(items: string[], options?: { sort?: boolean }): string[] {
	const labels = items.map((item) => item.trim()).filter((item) => item.length > 0);
	if (options?.sort !== false) {
		labels.sort((a, b) => a.localeCompare(b));
	}
	return labels;
}

/** A named, rendered resource section (e.g. `{ name: "Skills", labels: [...] }`). */
export interface ResourceSection {
	name: string;
	labels: string[];
}

/**
 * Build the Context / Skills / Extensions sections from loaded resources.
 * Empty sections are omitted, matching Pi's behaviour.
 */
export function buildResourceSections(input: {
	cwd: string;
	contextFiles: Array<{ path: string }>;
	skills: Array<{ name: string }>;
	extensions: ResourceRef[];
}): ResourceSection[] {
	const sections: ResourceSection[] = [];

	if (input.contextFiles.length > 0) {
		const labels = compactList(
			input.contextFiles.map((file) => formatContextPath(file.path, input.cwd)),
			{ sort: false },
		);
		if (labels.length > 0) {
			sections.push({ name: "Context", labels });
		}
	}

	if (input.skills.length > 0) {
		const labels = compactList(input.skills.map((skill) => skill.name));
		if (labels.length > 0) {
			sections.push({ name: "Skills", labels });
		}
	}

	if (input.extensions.length > 0) {
		const labels = compactList(getCompactExtensionLabels(input.extensions));
		if (labels.length > 0) {
			sections.push({ name: "Extensions", labels });
		}
	}

	return sections;
}
