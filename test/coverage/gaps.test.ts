import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeGaps, summarize } from '../../src/coverage/gaps';
import type { ModuleReport } from '../../src/coverage/gaps';
import { parseJacocoXml } from '../../src/coverage/jacoco';
import { parseRuleSet } from '../../src/coverage/rules';
import type { TestRuleSet } from '../../src/coverage/rules';

function rules(over: { include?: string[]; exclude?: string[]; min?: [number, number, number]; id?: string; priority?: number } = {}): TestRuleSet {
  const [line, branch, method] = over.min ?? [80, 70, 80];
  const text = [
    '---',
    `id: ${over.id ?? 'java-unit'}`,
    `priority: ${over.priority ?? 100}`,
    'include:',
    ...(over.include ?? ['**/src/main/java/**/*.java']).map((g) => `  - "${g}"`),
    ...(over.exclude && over.exclude.length > 0
      ? ['exclude:', ...over.exclude.map((g) => `  - "${g}"`)]
      : []),
    'coverage:',
    '  buildCommand: "mvn clean install"',
    `  minLineCoverage: ${line}`,
    `  minBranchCoverage: ${branch}`,
    `  minMethodCoverage: ${method}`,
    '---',
    'kurallar'
  ].join('\n');
  const parsed = parseRuleSet(text, 'r.md');
  if (!parsed.ruleSet) {
    throw new Error('test kural seti geçersiz: ' + JSON.stringify(parsed.errors));
  }
  return parsed.ruleSet;
}

/** `pkg` içinde tek sınıflı bir rapor kurar. */
function reportFor(opts: {
  pkg: string;
  file: string;
  cls: string;
  methods: Array<{ name: string; covered: boolean; branchMissed?: number; complexity?: number }>;
  lineMissed: number;
  lineCovered: number;
  branchMissed?: number;
  branchCovered?: number;
  uncoveredLines?: number[];
}): string {
  const methodXml = opts.methods
    .map(
      (m, i) => `
      <method name="${m.name.replace(/</g, '&lt;').replace(/>/g, '&gt;')}" desc="()V" line="${10 + i * 5}">
        <counter type="INSTRUCTION" missed="${m.covered ? 0 : 5}" covered="${m.covered ? 5 : 0}"/>
        ${m.branchMissed ? `<counter type="BRANCH" missed="${m.branchMissed}" covered="0"/>` : ''}
        <counter type="LINE" missed="${m.covered ? 0 : 2}" covered="${m.covered ? 2 : 0}"/>
        <counter type="COMPLEXITY" missed="${m.covered ? 0 : (m.complexity ?? 1)}" covered="${m.covered ? (m.complexity ?? 1) : 0}"/>
        <counter type="METHOD" missed="${m.covered ? 0 : 1}" covered="${m.covered ? 1 : 0}"/>
      </method>`
    )
    .join('');
  const methodMissed = opts.methods.filter((m) => !m.covered).length;
  const methodCovered = opts.methods.length - methodMissed;
  const lines = (opts.uncoveredLines ?? []).map((nr) => `<line nr="${nr}" mi="3" ci="0" mb="0" cb="0"/>`).join('');
  return `<report name="r"><package name="${opts.pkg}">
    <class name="${opts.pkg}/${opts.cls}" sourcefilename="${opts.file}">${methodXml}
      <counter type="METHOD" missed="${methodMissed}" covered="${methodCovered}"/>
    </class>
    <sourcefile name="${opts.file}">
      ${lines}
      <counter type="LINE" missed="${opts.lineMissed}" covered="${opts.lineCovered}"/>
      <counter type="BRANCH" missed="${opts.branchMissed ?? 0}" covered="${opts.branchCovered ?? 0}"/>
      <counter type="METHOD" missed="${methodMissed}" covered="${methodCovered}"/>
    </sourcefile>
  </package>
  <counter type="LINE" missed="${opts.lineMissed}" covered="${opts.lineCovered}"/>
  <counter type="BRANCH" missed="${opts.branchMissed ?? 0}" covered="${opts.branchCovered ?? 0}"/>
  <counter type="METHOD" missed="${methodMissed}" covered="${methodCovered}"/>
  </report>`;
}

function moduleOf(moduleRoot: string, xml: string): ModuleReport {
  const reportPath = moduleRoot
    ? `${moduleRoot}/target/site/jacoco/jacoco.xml`
    : 'target/site/jacoco/jacoco.xml';
  return { moduleRoot, reportPath, report: parseJacocoXml(xml) };
}

test('a class below the line threshold becomes a gap with its uncovered methods and lines', () => {
  const module = moduleOf(
    '',
    reportFor({
      pkg: 'com/kurum',
      file: 'OrderService.java',
      cls: 'OrderService',
      methods: [
        { name: 'create', covered: false, branchMissed: 4, complexity: 3 },
        { name: 'findAll', covered: true }
      ],
      lineMissed: 7,
      lineCovered: 3,
      uncoveredLines: [24, 25]
    })
  );

  const gaps = computeGaps({
    modules: [module],
    ruleSets: [rules()],
    sourceFiles: [],
    testFiles: ['src/test/java/com/kurum/OrderServiceTest.java']
  });

  assert.equal(gaps.length, 1);
  const gap = gaps[0];
  assert.ok(gap);
  assert.equal(gap.qualifiedName, 'com.kurum.OrderService');
  assert.equal(gap.sourcePath, 'src/main/java/com/kurum/OrderService.java');
  assert.equal(gap.testPath, 'src/test/java/com/kurum/OrderServiceTest.java');
  assert.equal(gap.testExists, true);
  assert.equal(Math.round(gap.lineCoverage), 30);
  assert.equal(gap.totalMethods, 2);
  assert.deepEqual(
    gap.uncoveredMethods.map((m) => m.name),
    ['create']
  );
  assert.deepEqual(gap.uncoveredLines, [24, 25]);
  assert.ok(gap.reasons.includes('below-threshold'));
  assert.ok(gap.reasons.includes('uncovered-methods'));
  assert.ok(!gap.reasons.includes('no-test-file'));
  assert.equal(gap.reportMissing, false);
});

test('a missing test file is flagged and pushes the gap up the list', () => {
  const module = moduleOf(
    'modules/order',
    reportFor({
      pkg: 'com/kurum',
      file: 'OrderService.java',
      cls: 'OrderService',
      methods: [{ name: 'create', covered: false }],
      lineMissed: 10,
      lineCovered: 0
    })
  );

  const [gap] = computeGaps({
    modules: [module],
    ruleSets: [rules()],
    sourceFiles: [],
    testFiles: []
  });

  assert.ok(gap);
  assert.equal(gap.moduleRoot, 'modules/order');
  assert.equal(gap.moduleName, 'order');
  assert.equal(gap.testPath, 'modules/order/src/test/java/com/kurum/OrderServiceTest.java');
  assert.equal(gap.testExists, false);
  assert.equal(gap.reasons[0], 'no-test-file');
  assert.ok(gap.reasons.includes('no-covered-method'));
});

test('a fully covered class above the thresholds is not a gap even without its own test file', () => {
  const module = moduleOf(
    '',
    reportFor({
      pkg: 'com/kurum',
      file: 'Mapper.java',
      cls: 'Mapper',
      methods: [{ name: 'map', covered: true }],
      lineMissed: 0,
      lineCovered: 10,
      branchMissed: 0,
      branchCovered: 4
    })
  );

  const gaps = computeGaps({ modules: [module], ruleSets: [rules()], sourceFiles: [], testFiles: [] });

  assert.deepEqual(gaps, []);
});

test('excluded paths are skipped entirely', () => {
  const module = moduleOf(
    '',
    reportFor({
      pkg: 'com/kurum/dto',
      file: 'OrderDto.java',
      cls: 'OrderDto',
      methods: [{ name: 'getId', covered: false }],
      lineMissed: 5,
      lineCovered: 0
    })
  );

  const gaps = computeGaps({
    modules: [module],
    ruleSets: [rules({ exclude: ['**/dto/**'] })],
    sourceFiles: ['src/main/java/com/kurum/dto/OrderDto.java'],
    testFiles: []
  });

  assert.deepEqual(gaps, []);
});

test('sources missing from the report (no tests at all, so no jacoco.xml) are reported as 0%', () => {
  const gaps = computeGaps({
    modules: [],
    ruleSets: [rules()],
    sourceFiles: [
      'src/main/java/com/kurum/OrderService.java',
      'src/main/java/com/kurum/dto/OrderDto.java'
    ],
    testFiles: []
  });

  assert.equal(gaps.length, 2);
  const service = gaps.find((g) => g.simpleName === 'OrderService');
  assert.ok(service);
  assert.equal(service.reportMissing, true);
  assert.equal(service.lineCoverage, 0);
  assert.equal(service.testExists, false);
  assert.ok(service.reasons.includes('no-covered-method'));
  assert.ok(service.reasons.includes('no-test-file'));
  assert.deepEqual(service.uncoveredMethods, []);
});

test('a source already seen in a report is not listed twice', () => {
  const module = moduleOf(
    '',
    reportFor({
      pkg: 'com/kurum',
      file: 'OrderService.java',
      cls: 'OrderService',
      methods: [{ name: 'create', covered: false }],
      lineMissed: 9,
      lineCovered: 1
    })
  );

  const gaps = computeGaps({
    modules: [module],
    ruleSets: [rules()],
    sourceFiles: ['src/main/java/com/kurum/OrderService.java'],
    testFiles: []
  });

  assert.equal(gaps.length, 1);
});

test('the highest priority matching rule set owns a source file', () => {
  const strict = rules({ id: 'strict', priority: 200, min: [95, 90, 95] });
  const loose = rules({ id: 'loose', priority: 10, min: [50, 50, 50] });
  const module = moduleOf(
    '',
    reportFor({
      pkg: 'com/kurum',
      file: 'OrderService.java',
      cls: 'OrderService',
      methods: [{ name: 'create', covered: true }],
      lineMissed: 1,
      lineCovered: 9
    })
  );

  const [gap] = computeGaps({
    modules: [module],
    ruleSets: [strict, loose],
    sourceFiles: [],
    testFiles: []
  });

  assert.ok(gap, '%90 kapsam, sıkı eşik altında olduğu için boşluktur');
  assert.equal(gap.ruleSetId, 'strict');
  assert.deepEqual(gap.thresholds, { line: 95, branch: 90, method: 95 });
});

test('gaps are ordered worst-first', () => {
  const modules = [
    moduleOf(
      '',
      reportFor({
        pkg: 'com/kurum',
        file: 'Small.java',
        cls: 'Small',
        methods: [{ name: 'a', covered: true }, { name: 'b', covered: false }],
        lineMissed: 2,
        lineCovered: 8
      })
    ),
    moduleOf(
      'mod',
      reportFor({
        pkg: 'com/kurum',
        file: 'Big.java',
        cls: 'Big',
        methods: [
          { name: 'a', covered: false, complexity: 5 },
          { name: 'b', covered: false, complexity: 4 }
        ],
        lineMissed: 40,
        lineCovered: 0
      })
    )
  ];

  const gaps = computeGaps({ modules, ruleSets: [rules()], sourceFiles: [], testFiles: [] });

  assert.deepEqual(
    gaps.map((g) => g.simpleName),
    ['Big', 'Small']
  );
  assert.ok((gaps[0]?.score ?? 0) > (gaps[1]?.score ?? 0));
});

test('static initialisers are not reported as untested methods', () => {
  const module = moduleOf(
    '',
    reportFor({
      pkg: 'com/kurum',
      file: 'Holder.java',
      cls: 'Holder',
      methods: [
        { name: '<clinit>', covered: false },
        { name: 'get', covered: false }
      ],
      lineMissed: 6,
      lineCovered: 0
    })
  );

  const [gap] = computeGaps({ modules: [module], ruleSets: [rules()], sourceFiles: [], testFiles: [] });

  assert.ok(gap);
  assert.deepEqual(
    gap.uncoveredMethods.map((m) => m.name),
    ['get']
  );
  assert.equal(gap.totalMethods, 1);
});

test('summarize aggregates every module into one figure', () => {
  const modules = [
    moduleOf(
      '',
      reportFor({
        pkg: 'p',
        file: 'A.java',
        cls: 'A',
        methods: [{ name: 'a', covered: true }],
        lineMissed: 0,
        lineCovered: 10,
        branchMissed: 0,
        branchCovered: 2
      })
    ),
    moduleOf(
      'm2',
      reportFor({
        pkg: 'p',
        file: 'B.java',
        cls: 'B',
        methods: [{ name: 'b', covered: false }],
        lineMissed: 10,
        lineCovered: 0,
        branchMissed: 2,
        branchCovered: 0
      })
    )
  ];

  const summary = summarize(modules);

  assert.equal(summary.moduleCount, 2);
  assert.equal(summary.classCount, 2);
  assert.deepEqual(summary.counters.line, { missed: 10, covered: 10 });
  assert.equal(summary.lineCoverage, 50);
  assert.equal(summary.branchCoverage, 50);
  assert.equal(summary.methodCoverage, 50);
});
