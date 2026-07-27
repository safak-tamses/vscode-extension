import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRuleSets } from '../../src/coverage/rulesLoader';
import type { RuleFileSystem } from '../../src/coverage/rulesLoader';

function ruleFile(id: string, priority: number, enabled = true): string {
  return [
    '---',
    `id: ${id}`,
    `priority: ${priority}`,
    `enabled: ${enabled}`,
    'include:',
    '  - "**/src/main/java/**/*.java"',
    'coverage:',
    '  buildCommand: "mvn clean install"',
    '---',
    'kurallar'
  ].join('\n');
}

class FakeFs implements RuleFileSystem {
  constructor(private readonly files: Record<string, string | Error>) {}
  async listRuleFiles(): Promise<string[]> {
    return Object.keys(this.files);
  }
  async readFile(path: string): Promise<string> {
    const entry = this.files[path];
    if (entry instanceof Error) {
      throw entry;
    }
    if (entry === undefined) {
      throw new Error('yok');
    }
    return entry;
  }
}

test('rule sets are sorted by descending priority then id', async () => {
  const fs = new FakeFs({
    'r/b.md': ruleFile('b-rules', 10),
    'r/a.md': ruleFile('a-rules', 200),
    'r/c.md': ruleFile('c-rules', 200)
  });

  const loaded = await loadRuleSets(fs, 'r');

  assert.deepEqual(
    loaded.ruleSets.map((r) => r.id),
    ['a-rules', 'c-rules', 'b-rules']
  );
  assert.equal(loaded.hasErrors, false);
});

test('disabled rule sets are reported but not applied', async () => {
  const fs = new FakeFs({ 'r/off.md': ruleFile('off-rules', 100, false) });

  const loaded = await loadRuleSets(fs, 'r');

  assert.deepEqual(loaded.ruleSets, []);
  assert.equal(loaded.files[0]?.disabled, true);
  assert.equal(loaded.files[0]?.ruleSetId, 'off-rules');
  assert.equal(loaded.hasErrors, false);
});

test('a broken file is reported without blocking the valid ones', async () => {
  const fs = new FakeFs({
    'r/good.md': ruleFile('good', 100),
    'r/broken.md': '---\nid: broken\n' // kapatılmamış frontmatter
  });

  const loaded = await loadRuleSets(fs, 'r');

  assert.deepEqual(
    loaded.ruleSets.map((r) => r.id),
    ['good']
  );
  assert.equal(loaded.hasErrors, true);
  const broken = loaded.files.find((f) => f.path === 'r/broken.md');
  assert.ok(broken);
  assert.ok(broken.errors.length > 0);
});

test('a duplicate id is rejected on the second file', async () => {
  const fs = new FakeFs({
    'r/a.md': ruleFile('same', 100),
    'r/b.md': ruleFile('same', 100)
  });

  const loaded = await loadRuleSets(fs, 'r');

  assert.equal(loaded.ruleSets.length, 1);
  assert.equal(loaded.hasErrors, true);
  const second = loaded.files.find((f) => f.path === 'r/b.md');
  assert.match(second?.errors[0]?.message ?? '', /benzersiz olmalı/);
});

test('an unreadable file becomes a file-level error', async () => {
  const fs = new FakeFs({ 'r/x.md': new Error('EACCES') });

  const loaded = await loadRuleSets(fs, 'r');

  assert.equal(loaded.hasErrors, true);
  assert.match(loaded.files[0]?.errors[0]?.message ?? '', /Dosya okunamadı: EACCES/);
});

test('an empty rules directory yields no rule sets and no errors', async () => {
  const loaded = await loadRuleSets(new FakeFs({}), 'r');

  assert.deepEqual(loaded.ruleSets, []);
  assert.deepEqual(loaded.files, []);
  assert.equal(loaded.hasErrors, false);
});
