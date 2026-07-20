import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  evaluateHookInput,
  isDocsPath,
  readDocsApproval,
} from './docs-guard.mjs';

const scriptPath = fileURLToPath(new URL('./docs-guard.mjs', import.meta.url));

function runCli(input, approvalFile) {
  return spawnSync(process.execPath, [scriptPath], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
    env: {
      ...process.env,
      ...(approvalFile
        ? { KNOWLEDGE_HUB_DOCS_APPROVAL_FILE: approvalFile }
        : {}),
    },
  });
}

describe('isDocsPath', () => {
  test('matches relative and absolute paths under docs/', () => {
    for (const path of [
      'docs/ARCHITECTURE.md',
      'docs/API.md',
      '/Users/owner/knowledge-hub/docs/REFERENCE.md',
    ]) {
      assert.equal(isDocsPath(path), true, path);
    }
  });

  test('does not match paths merely resembling docs', () => {
    for (const path of [
      'src/config.ts',
      'mydocs/file.md',
      'scripts/agent-hooks/docs-guard.mjs',
      'README.md',
    ]) {
      assert.equal(isDocsPath(path), false, path);
    }
  });
});

describe('Claude Code payloads', () => {
  test('asks for approval on Edit/Write under docs/', () => {
    for (const toolName of ['Edit', 'Write']) {
      const result = evaluateHookInput({
        tool_name: toolName,
        tool_input: { file_path: 'docs/REFERENCE.md' },
      });
      assert.equal(result.action, 'ask', toolName);
    }
  });

  test('allows Edit/Write outside docs/ and unrelated tools', () => {
    assert.deepEqual(
      evaluateHookInput({
        tool_name: 'Edit',
        tool_input: { file_path: 'src/config.ts' },
      }),
      { action: 'allow' },
    );
    assert.deepEqual(
      evaluateHookInput({
        tool_name: 'Read',
        tool_input: { file_path: 'docs/REFERENCE.md' },
      }),
      { action: 'allow' },
    );
  });
});

describe('Codex apply_patch payloads', () => {
  test('denies a patch that touches docs/', () => {
    const result = evaluateHookInput({
      tool_name: 'apply_patch',
      tool_input: {
        command: `*** Begin Patch
*** Update File: docs/REFERENCE.md
@@
+new line
*** End Patch`,
      },
    });
    assert.equal(result.action, 'deny');
  });

  test('allows only the exact approved docs path and marks approval for consumption', () => {
    const approved = evaluateHookInput(
      {
        tool_name: 'apply_patch',
        tool_input: {
          command: `*** Begin Patch
*** Update File: /repo/docs/ARCHITECTURE.md
@@
+approved line
*** End Patch`,
        },
      },
      {
        projectRoot: '/repo',
        approvedDocsPaths: ['docs/ARCHITECTURE.md'],
      },
    );
    assert.deepEqual(approved, { action: 'allow', consumeApproval: true });

    const wrongPath = evaluateHookInput(
      {
        tool_name: 'apply_patch',
        tool_input: {
          command: `*** Begin Patch
*** Update File: /repo/docs/API.md
@@
+not approved
*** End Patch`,
        },
      },
      {
        projectRoot: '/repo',
        approvedDocsPaths: ['docs/ARCHITECTURE.md'],
      },
    );
    assert.equal(wrongPath.action, 'deny');
  });

  test('allows a patch outside docs/, even when content mentions docs paths', () => {
    const result = evaluateHookInput({
      tool_name: 'apply_patch',
      tool_input: {
        command: `*** Begin Patch
*** Update File: src/config.ts
@@
+// see docs/REFERENCE.md
*** End Patch`,
      },
    });
    assert.deepEqual(result, { action: 'allow' });
  });

  test('fails closed when a patch has no recognized file header', () => {
    const result = evaluateHookInput({
      tool_name: 'apply_patch',
      tool_input: { command: 'not a patch' },
    });
    assert.equal(result.action, 'deny');
  });
});

describe('one-use approval marker', () => {
  test('accepts only a non-expired marker containing docs paths', () => {
    const directory = mkdtempSync(join(tmpdir(), 'docs-guard-'));
    const marker = join(directory, 'approval.json');
    try {
      writeFileSync(
        marker,
        JSON.stringify({
          paths: ['docs/ARCHITECTURE.md'],
          expires_at: '2100-01-01T00:00:00.000Z',
        }),
      );
      assert.deepEqual(readDocsApproval(marker, Date.parse('2099-01-01T00:00:00Z')), {
        paths: ['docs/ARCHITECTURE.md'],
      });
      assert.equal(readDocsApproval(marker, Date.parse('2101-01-01T00:00:00Z')), null);

      writeFileSync(
        marker,
        JSON.stringify({
          paths: ['README.md'],
          expires_at: '2100-01-01T00:00:00.000Z',
        }),
      );
      assert.equal(readDocsApproval(marker, Date.parse('2099-01-01T00:00:00Z')), null);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('CLI behavior', () => {
  test('emits an ask decision for Claude Code docs edits', () => {
    const result = runCli({
      tool_name: 'Write',
      tool_input: { file_path: 'docs/API.md' },
    });
    assert.equal(result.status, 0);
    const output = JSON.parse(result.stdout);
    assert.equal(output.hookSpecificOutput.permissionDecision, 'ask');
  });

  test('uses exit code 2 and stderr for denied Codex patches', () => {
    const result = runCli({
      tool_name: 'apply_patch',
      tool_input: {
        command: `*** Begin Patch
*** Update File: docs/API.md
@@
+x
*** End Patch`,
      },
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /requires user approval/);
  });

  test('consumes a matching approval marker and rejects reuse', () => {
    const directory = mkdtempSync(join(tmpdir(), 'docs-guard-cli-'));
    const marker = join(directory, 'approval.json');
    const input = {
      tool_name: 'apply_patch',
      tool_input: {
        command: `*** Begin Patch
*** Update File: docs/ARCHITECTURE.md
@@
+x
*** End Patch`,
      },
    };

    try {
      writeFileSync(
        marker,
        JSON.stringify({
          paths: ['docs/ARCHITECTURE.md'],
          expires_at: '2100-01-01T00:00:00.000Z',
        }),
      );
      const allowed = runCli(input, marker);
      assert.equal(allowed.status, 0);
      assert.equal(existsSync(marker), false);

      const reused = runCli(input, marker);
      assert.equal(reused.status, 2);
      assert.match(reused.stderr, /requires user approval/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('stays silent with exit code 0 when allowed', () => {
    const result = runCli({
      tool_name: 'Edit',
      tool_input: { file_path: 'src/index.ts' },
    });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  });

  test('fails closed on malformed JSON', () => {
    const result = runCli('{malformed');
    assert.equal(result.status, 2);
    assert.match(result.stderr, /malformed JSON/);
  });
});
