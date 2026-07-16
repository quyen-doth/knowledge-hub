#!/usr/bin/env node
// Shared PreToolUse hook for Claude Code (.claude/settings.json) and Codex (.codex/hooks.json).
// Edits under docs/ require explicit user approval (AGENTS.md, Documentation and Review).
// Claude Code Edit/Write payloads get permissionDecision "ask" so approval happens in the
// permission prompt. Codex apply_patch payloads are denied with exit 2 because the Codex hook
// protocol has no ask decision; the agent must obtain approval in chat before retrying.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { extractPatchPaths } from './block-env.mjs';

const DOCS_PATH_PATTERN = /(^|[\\/])docs[\\/]/;

export function isDocsPath(path) {
    return typeof path === 'string' && DOCS_PATH_PATTERN.test(path);
}

export function evaluateHookInput(input) {
    const tool = input?.tool_name;
    const toolInput = input?.tool_input ?? {};

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

        const docsPath = paths.find(isDocsPath);
        if (docsPath) {
            return {
                action: 'deny',
                reason: `AGENTS.md rule: editing "${docsPath}" under docs/ requires user approval. Ask the user before retrying.`,
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

    const result = evaluateHookInput(input);
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

    process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main();
}
