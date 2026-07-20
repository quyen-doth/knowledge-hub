#!/usr/bin/env node
// Shared PreToolUse hook for Claude Code (.claude/settings.json) and Codex (.codex/hooks.json).
// Edits under docs/ require explicit user approval (AGENTS.md, Documentation and Review).
// Claude Code Edit/Write payloads get permissionDecision "ask" so approval happens in the
// permission prompt. Codex apply_patch payloads are denied with exit 2 because the Codex hook
// protocol has no ask decision; the agent must obtain approval in chat before retrying.
import { readFileSync, unlinkSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { extractPatchPaths } from './block-env.mjs';

const DOCS_PATH_PATTERN = /(^|[\\/])docs[\\/]/;
const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DEFAULT_APPROVAL_FILE = resolve(PROJECT_ROOT, '.codex-docs-approval.json');

export function isDocsPath(path) {
    return typeof path === 'string' && DOCS_PATH_PATTERN.test(path);
}

function normalizeProjectPath(path, projectRoot) {
    if (!isAbsolute(path)) {
        return path.replaceAll('\\', '/').replace(/^\.\//, '');
    }

    const projectRelative = relative(projectRoot, path).replaceAll('\\', '/');
    if (projectRelative === '..' || projectRelative.startsWith('../')) {
        return path.replaceAll('\\', '/');
    }

    return projectRelative;
}

export function readDocsApproval(filePath, now = Date.now()) {
    try {
        const value = JSON.parse(readFileSync(filePath, 'utf8'));
        if (
            typeof value !== 'object' ||
            value === null ||
            !Array.isArray(value.paths) ||
            value.paths.length === 0 ||
            !value.paths.every((path) => typeof path === 'string' && isDocsPath(path)) ||
            typeof value.expires_at !== 'string'
        ) {
            return null;
        }

        const expiresAt = Date.parse(value.expires_at);
        if (!Number.isFinite(expiresAt) || expiresAt <= now) {
            return null;
        }

        return { paths: value.paths };
    } catch {
        return null;
    }
}

export function evaluateHookInput(input, options = {}) {
    const tool = input?.tool_name;
    const toolInput = input?.tool_input ?? {};
    const projectRoot = options.projectRoot ?? PROJECT_ROOT;
    const approvedDocsPaths = new Set(
        (options.approvedDocsPaths ?? []).map((path) =>
            normalizeProjectPath(path, projectRoot),
        ),
    );

    if (tool === 'Edit' || tool === 'Write') {
        if (isDocsPath(toolInput.file_path)) {
            return {
                action: 'ask',
                reason: `AGENTS.md rule: editing "${toolInput.file_path}" under docs/ requires user approval.`,
            };
        }

        return { action: 'allow' };
    }

    if (tool === 'apply_patch') {
        const command = typeof toolInput.command === 'string' ? toolInput.command : '';
        const paths = extractPatchPaths(command);
        if (paths.length === 0) {
            return {
                action: 'deny',
                reason: 'Blocked: apply_patch input has no recognized file header; the docs guard fails closed.',
            };
        }

        const docsPaths = paths.filter(isDocsPath);
        if (docsPaths.length > 0) {
            const allApproved = docsPaths.every((path) =>
                approvedDocsPaths.has(normalizeProjectPath(path, projectRoot)),
            );
            if (allApproved && approvedDocsPaths.size > 0) {
                return { action: 'allow', consumeApproval: true };
            }

            return {
                action: 'deny',
                reason: `AGENTS.md rule: editing "${docsPaths[0]}" under docs/ requires user approval. Ask the user, then create a scoped one-use approval marker before retrying.`,
            };
        }

        return { action: 'allow' };
    }

    return { action: 'allow' };
}

function main() {
    let input;
    try {
        input = JSON.parse(readFileSync(0, 'utf8'));
    } catch {
        process.stderr.write('Blocked: malformed JSON on stdin; the docs guard fails closed.');
        process.exit(2);
    }

    const approvalFile =
        process.env.KNOWLEDGE_HUB_DOCS_APPROVAL_FILE ?? DEFAULT_APPROVAL_FILE;
    const approval = readDocsApproval(approvalFile);
    const result = evaluateHookInput(input, {
        approvedDocsPaths: approval?.paths ?? [],
        projectRoot: PROJECT_ROOT,
    });
    if (result.action === 'ask') {
        process.stdout.write(
            JSON.stringify({
                hookSpecificOutput: {
                    hookEventName: 'PreToolUse',
                    permissionDecision: 'ask',
                    permissionDecisionReason: result.reason,
                },
            }),
        );
        process.exit(0);
    }

    if (result.action === 'deny') {
        process.stderr.write(result.reason);
        process.exit(2);
    }

    if (result.consumeApproval) {
        try {
            unlinkSync(approvalFile);
        } catch {
            process.stderr.write('Blocked: failed to consume the one-use docs approval marker.');
            process.exit(2);
        }
    }

    process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main();
}
