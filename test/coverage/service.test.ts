import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBuilds, ruleSetFor, scanCoverage } from '../../src/coverage/service';
import type { BuildRecord, CoverageScanPorts } from '../../src/coverage/service';
import type { DiscoveryResult } from '../../src/coverage/discover';
import { parseJacocoXml } from '../../src/coverage/jacoco';
import { parseRuleSet } from '../../src/coverage/rules';
import type { TestRuleSet } from '../../src/coverage/rules';
import type { LoadedRules } from '../../src/coverage/rulesLoader';
import type { AuditInput, AuditSink } from '../../src/audit/audit';

function ruleSet(id = 'java-unit', command = 'mvn clean install', priority = 100): TestRuleSet {
  const parsed = parseRuleSet(
    [
      '---',
      `id: ${id}`,
      `priority: ${priority}`,
      'include:',
      '  - "**/src/main/java/**/*.java"',
      'coverage:',
      `  buildCommand: "${command}"`,
      '---',
      'kurallar'
    ].join('\n'),
    `${id}.md`
  );
  if (!parsed.ruleSet) {
    throw new Error('kural seti geçersiz');
  }
  return parsed.ruleSet;
}

const REPORT = `<report name="r"><package name="com/kurum">
  <class name="com/kurum/OrderService" sourcefilename="OrderService.java">
    <method name="create" desc="()V" line="10">
      <counter type="METHOD" missed="1" covered="0"/>
    </method>
    <counter type="METHOD" missed="1" covered="0"/>
  </class>
  <sourcefile name="OrderService.java">
    <line nr="10" mi="4" ci="0" mb="0" cb="0"/>
    <counter type="LINE" missed="4" covered="0"/>
    <counter type="METHOD" missed="1" covered="0"/>
  </sourcefile>
</package>
<counter type="LINE" missed="4" covered="0"/>
<counter type="METHOD" missed="1" covered="0"/>
</report>`;

class CaptureAudit implements AuditSink {
  public events: AuditInput[] = [];
  async record(input: AuditInput): Promise<void> {
    this.events.push(input);
  }
}

function ports(over: Partial<CoverageScanPorts> = {}): { ports: CoverageScanPorts; audit: CaptureAudit; builds: string[] } {
  const audit = new CaptureAudit();
  const builds: string[] = [];
  const base: CoverageScanPorts = {
    loadRules: async (): Promise<LoadedRules> => ({
      ruleSets: [ruleSet()],
      files: [{ path: 'java-unit.md', ruleSetId: 'java-unit', disabled: false, errors: [], warnings: [] }],
      hasErrors: false
    }),
    discover: async (): Promise<DiscoveryResult> => ({
      modules: [
        { moduleRoot: '', reportPath: 'target/site/jacoco/jacoco.xml', report: parseJacocoXml(REPORT) }
      ],
      sourceFiles: ['src/main/java/com/kurum/OrderService.java'],
      testFiles: [],
      problems: []
    }),
    runBuild: async (rs): Promise<BuildRecord> => {
      builds.push(rs.coverage.buildCommand);
      return {
        ruleSetId: rs.id,
        command: rs.coverage.buildCommand,
        cwd: '',
        ok: true,
        durationMs: 4200,
        timedOut: false,
        cancelled: false,
        output: '[INFO] BUILD SUCCESS'
      };
    },
    audit,
    ...over
  };
  return { ports: base, audit, builds };
}

test('a scan without a build reads existing reports and computes gaps', async () => {
  const { ports: p, audit, builds } = ports();

  const result = await scanCoverage(p, { build: false });

  assert.deepEqual(builds, [], 'build:false iken derleme çalıştırılmaz');
  assert.equal(result.gaps.length, 1);
  assert.equal(result.gaps[0]?.qualifiedName, 'com.kurum.OrderService');
  assert.equal(result.summary.lineCoverage, 0);
  assert.equal(result.blocker, undefined);
  assert.equal(audit.events.filter((e) => e.type === 'coverage-scan').length, 1);
  assert.match(audit.events.at(-1)?.detail ?? '', /1 eksik test/);
});

test('a scan with a build runs the command once and records it', async () => {
  const { ports: p, audit, builds } = ports();

  const result = await scanCoverage(p, { build: true });

  assert.deepEqual(builds, ['mvn clean install']);
  assert.equal(result.builds.length, 1);
  assert.equal(result.builds[0]?.ok, true);
  const buildEvent = audit.events.find((e) => e.type === 'build');
  assert.equal(buildEvent?.ruleKey, 'java-unit');
  assert.equal(buildEvent?.durationMs, 4200);
  assert.match(buildEvent?.detail ?? '', /başarılı/);
});

test('the same build command shared by two rule sets runs only once', async () => {
  const { ports: p, builds } = ports({
    loadRules: async () => ({
      ruleSets: [ruleSet('a', 'mvn clean install', 200), ruleSet('b', 'mvn clean install', 100)],
      files: [],
      hasErrors: false
    })
  });

  await scanCoverage(p, { build: true });

  assert.deepEqual(builds, ['mvn clean install']);
});

test('distinct build commands each run once', async () => {
  const { ports: p, builds } = ports({
    loadRules: async () => ({
      ruleSets: [ruleSet('a', 'mvn -pl backend clean install', 200), ruleSet('b', 'mvn -pl bff clean install', 100)],
      files: [],
      hasErrors: false
    })
  });

  await scanCoverage(p, { build: true });

  assert.deepEqual(builds, ['mvn -pl backend clean install', 'mvn -pl bff clean install']);
});

test('a skipped build does not stop the scan and is reported', async () => {
  const { ports: p } = ports({
    runBuild: async (rs) => ({
      ruleSetId: rs.id,
      command: rs.coverage.buildCommand,
      cwd: '',
      ok: false,
      durationMs: 0,
      timedOut: false,
      cancelled: false,
      skippedReason: 'onay verilmedi',
      output: ''
    })
  });

  const result = await scanCoverage(p, { build: true });

  assert.equal(result.gaps.length, 1, 'var olan raporlarla devam eder');
  assert.match(formatBuilds(result.builds), /atlandı \(onay verilmedi\)/);
});

test('a build that returns undefined is treated as not attempted', async () => {
  const { ports: p } = ports({ runBuild: async () => undefined });

  const result = await scanCoverage(p, { build: true });

  assert.deepEqual(result.builds, []);
  assert.equal(result.gaps.length, 1);
  assert.match(formatBuilds(result.builds), /Derleme çalıştırılmadı/);
});

test('no enabled rule set blocks the scan with an actionable message', async () => {
  const { ports: p } = ports({
    loadRules: async () => ({ ruleSets: [], files: [], hasErrors: false })
  });

  const result = await scanCoverage(p, { build: true });

  assert.match(result.blocker ?? '', /Örnek Test Kural Setini Oluştur/);
  assert.deepEqual(result.gaps, []);
});

test('broken rule files block the scan with a different message', async () => {
  const { ports: p } = ports({
    loadRules: async () => ({
      ruleSets: [],
      files: [{ path: 'bad.md', disabled: false, errors: [{ line: 3, message: 'hata' }], warnings: [] }],
      hasErrors: true
    })
  });

  const result = await scanCoverage(p, { build: true });

  assert.match(result.blocker ?? '', /Kural dosyalarında hata var/);
  assert.equal(result.ruleFiles.length, 1);
});

test('no matching source files blocks with an include/exclude hint', async () => {
  const { ports: p } = ports({
    discover: async () => ({ modules: [], sourceFiles: [], testFiles: [], problems: [] })
  });

  const result = await scanCoverage(p, { build: false });

  assert.match(result.blocker ?? '', /include\/exclude desenlerini/);
});

test('cancelling stops before the next build command', async () => {
  let cancelled = false;
  const { ports: p, builds } = ports({
    loadRules: async () => ({
      ruleSets: [ruleSet('a', 'cmd-a', 200), ruleSet('b', 'cmd-b', 100)],
      files: [],
      hasErrors: false
    })
  });
  const cancel = {
    get isCancellationRequested(): boolean {
      return cancelled;
    },
    onCancellationRequested: (): { dispose(): void } => ({ dispose: () => undefined })
  };
  const wrapped: CoverageScanPorts = {
    ...p,
    runBuild: async (rs) => {
      cancelled = true;
      return p.runBuild(rs);
    }
  };

  await scanCoverage(wrapped, { build: true, cancel });

  assert.deepEqual(builds, ['cmd-a'], 'iptal sonrası ikinci komut çalıştırılmaz');
});

test('ruleSetFor links a gap back to the rule set that claimed it', async () => {
  const sets = [ruleSet('a'), ruleSet('b')];
  const { ports: p } = ports({
    loadRules: async () => ({ ruleSets: sets, files: [], hasErrors: false })
  });

  const result = await scanCoverage(p, { build: false });
  const gap = result.gaps[0];

  assert.ok(gap);
  assert.equal(ruleSetFor(gap, result.ruleSets)?.id, 'a');
  assert.equal(ruleSetFor({ ...gap, ruleSetId: 'yok' }, result.ruleSets), undefined);
});

test('formatBuilds distinguishes failure, timeout and cancellation', () => {
  const base: BuildRecord = {
    ruleSetId: 'r',
    command: 'mvn test',
    cwd: '',
    ok: false,
    durationMs: 1500,
    timedOut: false,
    cancelled: false,
    output: ''
  };

  assert.match(formatBuilds([base]), /mvn test: BAŞARISIZ \(1\.5 sn\)/);
  assert.match(formatBuilds([{ ...base, timedOut: true }]), /zaman aşımı/);
  assert.match(formatBuilds([{ ...base, cancelled: true }]), /iptal edildi/);
  assert.match(formatBuilds([{ ...base, ok: true }]), /başarılı/);
});
