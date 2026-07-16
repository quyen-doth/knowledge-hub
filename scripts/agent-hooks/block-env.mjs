#!/usr/bin/env node
// Shared PreToolUse hook for Claude Code (.claude/settings.json) and Codex (.codex/hooks.json).
// Blocks access to dotenv and Wrangler local-secret files (.env*, .dev.vars*) while allowing
// placeholder-only templates. Fails closed: malformed input and unparseable patches are blocked.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ALLOWED_TEMPLATE_BASENAMES = new Set([
    '.env.example',
    '.env.sample',
    '.env.template',
    '.dev.vars.example',
]);

// Dotenv-style basenames (.env, .env.local, prod.env) and Wrangler local secrets (.dev.vars*).
const SECRET_BASENAME_PATTERN = /(^|\.)env(\.|$)|^\.dev\.vars(\.|$)/;

// Occurrences inside free text (Bash commands, Grep inputs). Boundary checks around each match
// keep code identifiers such as `process.env.NODE_ENV` from producing false positives.
const SECRET_REFERENCE_PATTERN = /\.env(?:\.[A-Za-z0-9_-]+)*|\.dev\.vars(?:\.[A-Za-z0-9_-]+)*/g;

export function isBlockedSecretPath(path) {
    if (typeof path !== 'string' || path === '') {
        return false;
    }

    const basename = path.split(/[\\/]/).pop();
    if (ALLOWED_TEMPLATE_BASENAMES.has(basename)) {
        return false;
    }

    return SECRET_BASENAME_PATTERN.test(basename);
}

function referencesSecretFile(text) {
    for (const match of text.matchAll(SECRET_REFERENCE_PATTERN)) {
        const before = text[match.index - 1];
        const after = text[match.index + match[0].length];
        const startsAtFilenameBoundary = !before || !/[A-Za-z0-9_-]/.test(before);
        const endsAtFilenameBoundary = !after || !/[A-Za-z0-9_-]/.test(after);

        if (
            startsAtFilenameBoundary &&
            endsAtFilenameBoundary &&
            !ALLOWED_TEMPLATE_BASENAMES.has(match[0])
        ) {
            return true;
        }
    }

    return false;
}

function containsSecretReference(value) {
    if (typeof value === 'string') {
        return referencesSecretFile(value);
    }

    if (Array.isArray(value)) {
        return value.some(containsSecretReference);
    }

    if (value && typeof value === 'object') {
        return Object.values(value).some(containsSecretReference);
    }

    return false;
}

const PATCH_FILE_HEADER_PATTERN = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/;
const PATCH_MOVE_PATTERN = /^\*\*\* Move to: (.+)$/;

// Returns every file path an apply_patch envelope touches: Add/Update/Delete headers first,
// then Move-to destinations. Patch body lines are content, not paths, and are ignored.
export function extractPatchPaths(command) {
    if (typeof command !== 'string') {
        return [];
    }

    const filePaths = [];
    const movePaths = [];
    for (const line of command.split('\n')) {
        const header = line.match(PATCH_FILE_HEADER_PATTERN);
        if (header) {
            filePaths.push(header[1].trim());
            continue;
        }

        const move = line.match(PATCH_MOVE_PATTERN);
        if (move) {
            movePaths.push(move[1].trim());
        }
    }

    return [...filePaths, ...movePaths];
}

export function evaluateHookInput(input) {
    const tool = input?.tool_name;
    const toolInput = input?.tool_input ?? {};

    if (tool === 'Read' || tool === 'Edit' || tool === 'Write') {
        if (isBlockedSecretPath(toolInput.file_path)) {
            return {
                blocked: true,
                reason: `Blocked access to secret file "${toolInput.file_path}". Only placeholder templates such as .env.example may be read.`,
            };
        }

        return { blocked: false };
    }

    if (tool === 'Grep') {
        if (isBlockedSecretPath(toolInput.path) || containsSecretReference(toolInput)) {
            return {
                blocked: true,
                reason: 'Blocked access to secret files through Grep. Only placeholder templates such as .env.example may be read.',
            };
        }

        return { blocked: false };
    }

    if (tool === 'Bash') {
        const command = typeof toolInput.command === 'string' ? toolInput.command : '';
        if (referencesSecretFile(command)) {
            return {
                blocked: true,
                reason: 'Blocked access to secret files through Bash. Only placeholder templates such as .env.example may be read.',
            };
        }

        return { blocked: false };
    }

    if (tool === 'apply_patch') {
        const command = typeof toolInput.command === 'string' ? toolInput.command : '';
        const paths = extractPatchPaths(command);
        if (paths.length === 0) {
            return {
                blocked: true,
                reason: 'Blocked access: apply_patch input has no recognized file header; the secret guard fails closed.',
            };
        }

        const secretPath = paths.find(isBlockedSecretPath);
        if (secretPath) {
            return {
                blocked: true,
                reason: `Blocked access to secret file "${secretPath}" through apply_patch. Only placeholder templates such as .env.example may be edited.`,
            };
        }

        return { blocked: false };
    }

    return { blocked: false };
}

function main() {
    let input;
    try {
        input = JSON.parse(readFileSync(0, 'utf8'));
    } catch {
        process.stderr.write('Blocked: malformed JSON on stdin; the secret guard fails closed.');
        process.exit(2);
    }

    const result = evaluateHookInput(input);
    if (result.blocked) {
        process.stderr.write(result.reason);
        process.exit(2);
    }

    process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main();
}
