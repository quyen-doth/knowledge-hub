import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  evaluateHookInput,
  extractPatchPaths,
  isBlockedSecretPath,
} from './block-env.mjs';

const scriptPath = fileURLToPath(new URL('./block-env.mjs', import.meta.url));

function runCli(input) {
  return spawnSync(process.execPath, [scriptPath], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
  });
}

describe('isBlockedSecretPath', () => {
  test('blocks environment and Cloudflare local-secret files', () => {
    for (const path of [
      '.env',
      '.env.local',
      'config/.env.production',
      '.dev.vars',
      'apps/worker/.dev.vars.preview',
    ]) {
      assert.equal(isBlockedSecretPath(path), true, path);
    }
  });

  test('allows placeholder-only templates and normal source paths', () => {
    for (const path of [
      '.env.example',
      '.env.sample',
      '.env.template',
      '.dev.vars.example',
      'docs/REFERENCE.md',
      'src/config.ts',
    ]) {
      assert.equal(isBlockedSecretPath(path), false, path);
    }
  });
});

describe('Claude Code payloads', () => {
  test('blocks direct Read/Edit/Write/Grep paths', () => {
    for (const toolName of ['Read', 'Edit', 'Write', 'Grep']) {
      const key = toolName === 'Grep' ? 'path' : 'file_path';
      const result = evaluateHookInput({
        tool_name: toolName,
        tool_input: { [key]: '.env.local' },
      });
      assert.equal(result.blocked, true, toolName);
    }
  });

  test('allows reading a placeholder template', () => {
    assert.deepEqual(
      evaluateHookInput({
        tool_name: 'Read',
        tool_input: { file_path: '.dev.vars.example' },
      }),
      { blocked: false },
    );
  });
});

describe('Bash payloads', () => {
  test('blocks common attempts to read or redirect to secret files', () => {
    for (const command of [
      "sed -n '1,20p' .env",
      'cat config/.env.production',
      'cp template .dev.vars',
      'FILE=.env.local node script.mjs',
    ]) {
      const result = evaluateHookInput({
        tool_name: 'Bash',
        tool_input: { command },
      });
      assert.equal(result.blocked, true, command);
    }
  });

  test('allows placeholder templates and normal environment-binding code', () => {
    for (const command of [
      "sed -n '1,20p' .env.example",
      'rg ANTHROPIC_API_KEY src/config.ts',
      "node -e 'console.log(\"env.ANTHROPIC_API_KEY\")'",
    ]) {
      assert.deepEqual(
        evaluateHookInput({ tool_name: 'Bash', tool_input: { command } }),
        { blocked: false },
        command,
      );
    }
  });
});

describe('Codex apply_patch payloads', () => {
  test('extracts every file path controlled by a patch', () => {
    const command = `*** Begin Patch
*** Update File: docs/REFERENCE.md
*** Move to: docs/reference.md
*** Add File: src/config.ts
*** End Patch`;

    assert.deepEqual(extractPatchPaths(command), [
      'docs/REFERENCE.md',
      'src/config.ts',
      'docs/reference.md',
    ]);
  });

  test('blocks a patch targeting a real secret file', () => {
    const result = evaluateHookInput({
      tool_name: 'apply_patch',
      tool_input: {
        command: `*** Begin Patch
*** Update File: .dev.vars
@@
-OLD=value
+NEW=value
*** End Patch`,
      },
    });
    assert.equal(result.blocked, true);
  });

  test('allows documentation content that merely mentions secret filenames', () => {
    const result = evaluateHookInput({
      tool_name: 'apply_patch',
      tool_input: {
        command: `*** Begin Patch
*** Update File: docs/REFERENCE.md
@@
+Never commit .env or .dev.vars files.
*** End Patch`,
      },
    });
    assert.deepEqual(result, { blocked: false });
  });

  test('fails closed when a patch has no recognized file header', () => {
    const result = evaluateHookInput({
      tool_name: 'apply_patch',
      tool_input: { command: 'not a patch' },
    });
    assert.equal(result.blocked, true);
  });
});

describe('CLI behavior', () => {
  test('uses exit code 2 and stderr when blocked', () => {
    const result = runCli({
      tool_name: 'Read',
      tool_input: { file_path: '.env' },
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Blocked access/);
  });

  test('uses exit code 0 when allowed', () => {
    const result = runCli({
      tool_name: 'Read',
      tool_input: { file_path: '.env.example' },
    });
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
  });

  test('fails closed on malformed JSON', () => {
    const result = runCli('{malformed');
    assert.equal(result.status, 2);
    assert.match(result.stderr, /malformed JSON/);
  });
});
