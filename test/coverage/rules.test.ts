import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseRuleSet, parseScalar } from '../../src/coverage/rules';

const MINIMAL = [
  '---',
  'id: java-unit',
  'include:',
  '  - "**/src/main/java/**/*.java"',
  'coverage:',
  '  buildCommand: "mvn clean install"',
  '---',
  '',
  '## Kurallar',
  '- Her public metot test edilir.'
].join('\n');

test('parseScalar types quoted strings, booleans and numbers', () => {
  assert.equal(parseScalar('"a: b"'), 'a: b');
  assert.equal(parseScalar("'x'"), 'x');
  assert.equal(parseScalar('true'), true);
  assert.equal(parseScalar('false'), false);
  assert.equal(parseScalar('80'), 80);
  assert.equal(parseScalar('-1.5'), -1.5);
  assert.equal(parseScalar('mvn clean install'), 'mvn clean install');
});

test('a minimal rule set parses and fills in sane defaults', () => {
  const { ruleSet, errors, warnings } = parseRuleSet(MINIMAL, '.code-health/rules/a.md');

  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  assert.ok(ruleSet);
  assert.equal(ruleSet.id, 'java-unit');
  assert.equal(ruleSet.name, 'java-unit'); // name verilmezse id'ye düşer
  assert.equal(ruleSet.language, 'java');
  assert.equal(ruleSet.enabled, true);
  assert.equal(ruleSet.priority, 100);
  assert.deepEqual(ruleSet.include, ['**/src/main/java/**/*.java']);
  assert.deepEqual(ruleSet.exclude, []);
  assert.equal(ruleSet.coverage.tool, 'jacoco');
  assert.equal(ruleSet.coverage.reportPath, '**/target/site/jacoco/jacoco.xml');
  assert.equal(ruleSet.coverage.buildCommand, 'mvn clean install');
  assert.equal(ruleSet.coverage.minLineCoverage, 80);
  assert.equal(ruleSet.coverage.minBranchCoverage, 70);
  assert.equal(ruleSet.test.testRoot, 'src/test/java');
  assert.equal(ruleSet.test.suffix, 'Test');
  assert.equal(ruleSet.sourceFile, '.code-health/rules/a.md');
});

test('the markdown body after the frontmatter is preserved verbatim as guidelines', () => {
  const text = [
    '---',
    'id: x',
    'include:',
    '  - "a/**"',
    'coverage:',
    '  buildCommand: "mvn test"',
    '---',
    '',
    '## Başlık',
    '',
    '- madde 1',
    '- `kod` içeren madde',
    '',
    '```java',
    'assertThat(x).isEqualTo(1);',
    '```'
  ].join('\n');

  const { ruleSet } = parseRuleSet(text, 'r.md');

  assert.ok(ruleSet);
  assert.equal(
    ruleSet.guidelines,
    ['## Başlık', '', '- madde 1', '- `kod` içeren madde', '', '```java', 'assertThat(x).isEqualTo(1);', '```'].join(
      '\n'
    )
  );
});

test('lists, nested maps, comments and blank lines are all supported', () => {
  const text = [
    '---',
    '# yorum satırı',
    'id: full',
    'name: "Tam Kural Seti"',
    'enabled: false',
    'priority: 50',
    'include:',
    '  - "src/main/java/**/*.java"',
    '  # liste içinde yorum',
    '  - "lib/**/*.java"',
    'exclude:',
    '  - "**/dto/**"',
    'coverage:',
    '  tool: jacoco',
    '  reportPath: "**/jacoco.xml"',
    '  buildCommand: "mvn -B clean install"',
    '  minLineCoverage: 90',
    '  minBranchCoverage: 85',
    '  minMethodCoverage: 95',
    '  buildTimeoutSec: 1200',
    'test:',
    '  framework: junit5',
    '  testRoot: "src/test/java"',
    '  suffix: IT',
    '---',
    'gövde'
  ].join('\n');

  const { ruleSet, errors } = parseRuleSet(text, 'r.md');

  assert.deepEqual(errors, []);
  assert.ok(ruleSet);
  assert.equal(ruleSet.name, 'Tam Kural Seti');
  assert.equal(ruleSet.enabled, false);
  assert.equal(ruleSet.priority, 50);
  assert.deepEqual(ruleSet.include, ['src/main/java/**/*.java', 'lib/**/*.java']);
  assert.deepEqual(ruleSet.exclude, ['**/dto/**']);
  assert.equal(ruleSet.coverage.minLineCoverage, 90);
  assert.equal(ruleSet.coverage.minBranchCoverage, 85);
  assert.equal(ruleSet.coverage.minMethodCoverage, 95);
  assert.equal(ruleSet.coverage.buildTimeoutSec, 1200);
  assert.equal(ruleSet.test.suffix, 'IT');
});

test('a missing frontmatter block is reported instead of silently ignored', () => {
  const { ruleSet, errors } = parseRuleSet('# sadece markdown\n', 'r.md');

  assert.equal(ruleSet, undefined);
  assert.equal(errors.length, 1);
  assert.match(errors[0]?.message ?? '', /`---` satırıyla başlamalı/);
});

test('an unterminated frontmatter block is reported', () => {
  const { ruleSet, errors } = parseRuleSet('---\nid: x\n', 'r.md');

  assert.equal(ruleSet, undefined);
  assert.match(errors[0]?.message ?? '', /kapatılmamış/);
});

test('required fields are named when missing', () => {
  const { ruleSet, errors } = parseRuleSet('---\nname: yok\n---\n', 'r.md');

  assert.equal(ruleSet, undefined);
  const messages = errors.map((e) => e.message).join(' | ');
  assert.match(messages, /Zorunlu alan eksik: "id"/);
  assert.match(messages, /Zorunlu alan eksik: "include"/);
  assert.match(messages, /Zorunlu alan eksik: "coverage\.buildCommand"/);
});

test('syntax outside the supported subset fails with a line number', () => {
  const text = ['---', 'id: x', 'bu satır anahtar değil', '---'].join('\n');

  const { errors } = parseRuleSet(text, 'r.md');

  const bad = errors.find((e) => /Anlaşılamayan satır/.test(e.message));
  assert.ok(bad, 'anlaşılamayan satır raporlanmalı');
  assert.equal(bad.line, 3);
});

test('tab indentation is rejected with a clear message', () => {
  const text = ['---', 'id: x', 'include:', '\t- "a/**"', '---'].join('\n');

  const { errors } = parseRuleSet(text, 'r.md');

  const tab = errors.find((e) => /sekme \(TAB\)/.test(e.message));
  assert.ok(tab);
  assert.equal(tab.line, 4);
});

test('mixing a list and a map under one key is rejected', () => {
  const text = ['---', 'id: x', 'coverage:', '  - "a"', '  buildCommand: "mvn"', '---'].join('\n');

  const { errors } = parseRuleSet(text, 'r.md');

  assert.ok(errors.some((e) => /karışık kullanılamaz/.test(e.message)));
});

test('out-of-range thresholds and wrong types are rejected with the field name', () => {
  const text = [
    '---',
    'id: x',
    'enabled: belki',
    'include:',
    '  - "a/**"',
    'coverage:',
    '  buildCommand: "mvn"',
    '  minLineCoverage: 140',
    '  buildTimeoutSec: metin',
    '---'
  ].join('\n');

  const { errors } = parseRuleSet(text, 'r.md');
  const messages = errors.map((e) => e.message).join(' | ');

  assert.match(messages, /"enabled" true veya false olmalı/);
  assert.match(messages, /"coverage\.minLineCoverage" 0-100 aralığında/);
  assert.match(messages, /"coverage\.buildTimeoutSec" sayı olmalı/);
});

test('unsupported language and coverage tool are rejected', () => {
  const text = [
    '---',
    'id: x',
    'language: kotlin',
    'include:',
    '  - "a/**"',
    'coverage:',
    '  tool: cobertura',
    '  buildCommand: "mvn"',
    '---'
  ].join('\n');

  const messages = parseRuleSet(text, 'r.md')
    .errors.map((e) => e.message)
    .join(' | ');

  assert.match(messages, /yalnızca "java"/);
  assert.match(messages, /yalnızca "jacoco"/);
});

test('unknown fields are warnings, not errors', () => {
  const text = [
    '---',
    'id: x',
    'sürüm: 3',
    'include:',
    '  - "a/**"',
    'coverage:',
    '  buildCommand: "mvn"',
    '  parallel: true',
    '---',
    'gövde'
  ].join('\n');

  const { ruleSet, errors, warnings } = parseRuleSet(text, 'r.md');

  assert.deepEqual(errors, []);
  assert.ok(ruleSet);
  const messages = warnings.map((w) => w.message).join(' | ');
  assert.match(messages, /"sürüm"/);
  assert.match(messages, /"coverage\.parallel"/);
});

test('an empty guidelines body warns that the rules will not reach the model', () => {
  const text = ['---', 'id: x', 'include:', '  - "a/**"', 'coverage:', '  buildCommand: "mvn"', '---', '  '].join('\n');

  const { ruleSet, warnings } = parseRuleSet(text, 'r.md');

  assert.ok(ruleSet);
  assert.match(warnings.map((w) => w.message).join(' '), /Kural gövdesi boş/);
});

test('the shipped sample rule set parses with no errors or warnings', async () => {
  const path = join(process.cwd(), 'resources', 'rules', 'java-spring-unit-tests.md');
  const text = await readFile(path, 'utf8');

  const { ruleSet, errors, warnings } = parseRuleSet(text, '.code-health/rules/java-spring-unit-tests.md');

  assert.deepEqual(errors, [], 'örnek kural seti hatasız olmalı');
  assert.deepEqual(warnings, [], 'örnek kural seti uyarısız olmalı');
  assert.ok(ruleSet);
  assert.equal(ruleSet.id, 'java-spring-unit-tests');
  assert.equal(ruleSet.coverage.buildCommand, 'mvn -B clean install');
  assert.equal(ruleSet.coverage.reportPath, '**/target/site/jacoco/jacoco.xml');
  assert.equal(ruleSet.test.assertions, 'assertj');
  assert.ok(ruleSet.guidelines.includes('assertThatThrownBy'), 'kural gövdesi modele iletilecek metni içermeli');
});
