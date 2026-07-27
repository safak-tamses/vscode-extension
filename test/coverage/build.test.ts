import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NodeBuildRunner, extractCompilerErrors } from '../../src/coverage/build';

test('extractCompilerErrors keeps only the diagnostic lines', () => {
  const output = [
    '[INFO] Scanning for projects...',
    '[INFO] Compiling 42 source files',
    '[ERROR] /src/test/java/com/x/AT.java:[12,9] cannot find symbol',
    '[ERROR]   symbol:   method assertThat(int)',
    '[INFO] BUILD FAILURE',
    '[INFO] Total time: 4.2 s'
  ].join('\n');

  const errors = extractCompilerErrors(output);

  assert.match(errors, /cannot find symbol/);
  assert.match(errors, /BUILD FAILURE/);
  assert.ok(!errors.includes('Scanning for projects'));
});

test('extractCompilerErrors falls back to the tail when nothing matches', () => {
  const output = Array.from({ length: 100 }, (_, i) => `satir ${i}`).join('\n');

  const errors = extractCompilerErrors(output, 5);

  assert.equal(errors.split('\n').length, 5);
  assert.match(errors, /satir 95/);
});

test('a successful command reports exit code 0 and streams its output', async () => {
  const chunks: string[] = [];
  const result = await new NodeBuildRunner().run('echo kod-sagligi-ok', process.cwd(), {
    timeoutSec: 30,
    onOutput: (chunk) => chunks.push(chunk)
  });

  assert.equal(result.code, 0);
  assert.equal(result.ok, true);
  assert.equal(result.timedOut, false);
  assert.match(result.output, /kod-sagligi-ok/);
  assert.match(chunks.join(''), /kod-sagligi-ok/);
  assert.ok(result.durationMs >= 0);
});

test('a failing command reports a non-zero exit code and keeps stderr', async () => {
  const result = await new NodeBuildRunner().run('echo bozuk 1>&2; exit 3', process.cwd(), {
    timeoutSec: 30
  });

  assert.equal(result.code, 3);
  assert.equal(result.ok, false);
  assert.match(result.output, /bozuk/);
});

test('a command that overruns the timeout is terminated and marked timedOut', async () => {
  const result = await new NodeBuildRunner().run('sleep 30', process.cwd(), { timeoutSec: 1 });

  assert.equal(result.ok, false);
  assert.equal(result.timedOut, true);
  assert.match(result.output, /Zaman aşımı/);
});

test('cancellation terminates the command and is reported separately from failure', async () => {
  const listeners: Array<() => void> = [];
  let cancelled = false;
  const cancel = {
    get isCancellationRequested(): boolean {
      return cancelled;
    },
    onCancellationRequested(listener: () => void): { dispose(): void } {
      listeners.push(listener);
      return { dispose: () => undefined };
    }
  };

  const pending = new NodeBuildRunner().run('sleep 30', process.cwd(), { timeoutSec: 60, cancel });
  await new Promise((resolve) => setTimeout(resolve, 200));
  cancelled = true;
  listeners.forEach((l) => l());

  const result = await pending;

  assert.equal(result.cancelled, true);
  assert.equal(result.timedOut, false);
  assert.equal(result.ok, false);
  assert.match(result.output, /iptal etti/);
});
