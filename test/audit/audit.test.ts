import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLogger, FsFileAppender } from '../../src/audit/audit';
import type { FileAppender, OutputSink } from '../../src/audit/audit';

class CaptureAppender implements FileAppender {
  public lines: string[] = [];
  async append(line: string): Promise<void> {
    this.lines.push(line);
  }
}

class CaptureOutput implements OutputSink {
  public lines: string[] = [];
  line(text: string): void {
    this.lines.push(text);
  }
}

const fixedClock = { now: () => new Date('2026-06-25T10:00:00.000Z') };

test('record writes a JSONL line with type, ISO timestamp, actor and fields', async () => {
  const appender = new CaptureAppender();
  const output = new CaptureOutput();
  const logger = new AuditLogger(appender, output, 'safak', fixedClock);

  await logger.record({ type: 'suggestion', ruleKey: 'java:S2095', issueKey: 'k1', file: 'src/A.java' });

  assert.equal(appender.lines.length, 1);
  const obj = JSON.parse(appender.lines[0] ?? '');
  assert.equal(obj.type, 'suggestion');
  assert.equal(obj.at, '2026-06-25T10:00:00.000Z');
  assert.equal(obj.actor, 'safak');
  assert.equal(obj.ruleKey, 'java:S2095');
  assert.equal(obj.issueKey, 'k1');
  assert.equal(obj.file, 'src/A.java');
});

test('record emits a human-readable output line', async () => {
  const appender = new CaptureAppender();
  const output = new CaptureOutput();
  const logger = new AuditLogger(appender, output, 'safak', fixedClock);

  await logger.record({ type: 'accept', ruleKey: 'java:S2095', issueKey: 'k1' });

  assert.equal(output.lines.length, 1);
  assert.match(output.lines[0] ?? '', /ACCEPT/);
  assert.match(output.lines[0] ?? '', /k1/);
});

test('serializes only known audit fields and omits undefined (no leakage)', async () => {
  const appender = new CaptureAppender();
  const logger = new AuditLogger(appender, new CaptureOutput(), 'u', fixedClock);

  await logger.record({ type: 'reject', issueKey: 'k' });

  const obj = JSON.parse(appender.lines[0] ?? '');
  const allowed = ['type', 'at', 'actor', 'ruleKey', 'issueKey', 'file', 'detail'];
  for (const key of Object.keys(obj)) {
    assert.ok(allowed.includes(key), `beklenmeyen alan: ${key}`);
  }
  assert.ok(!('ruleKey' in obj)); // verilmeyen alanlar atlanır
  assert.ok(!('file' in obj));
});

test('FsFileAppender creates directory and frames lines with newline', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ch-audit-'));
  const path = join(dir, 'nested', 'audit.log');
  const appender = new FsFileAppender(path);

  await appender.append('{"a":1}');
  await appender.append('{"b":2}');

  const content = await readFile(path, 'utf8');
  assert.equal(content, '{"a":1}\n{"b":2}\n');
});
