import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  JacocoParseError,
  addCounters,
  describeSignature,
  parseJacocoXml,
  ratio
} from '../../src/coverage/jacoco';

/** Gerçek JaCoCo çıktısına yakın bir örnek: XML bildirimi, DOCTYPE, yorum ve iç sınıf içerir. */
const REPORT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<!DOCTYPE report PUBLIC "-//JACOCO//DTD Report 1.1//EN" "report.dtd">
<report name="order-service">
  <sessioninfo id="host-1" start="1700000000000" dump="1700000001000"/>
  <!-- paket düzeyi -->
  <package name="com/kurum/order/service">
    <class name="com/kurum/order/service/OrderService" sourcefilename="OrderService.java">
      <method name="&lt;init&gt;" desc="(Lcom/kurum/order/repo/OrderRepository;)V" line="18">
        <counter type="INSTRUCTION" missed="0" covered="6"/>
        <counter type="LINE" missed="0" covered="2"/>
        <counter type="COMPLEXITY" missed="0" covered="1"/>
        <counter type="METHOD" missed="0" covered="1"/>
      </method>
      <method name="create" desc="(Lcom/kurum/order/dto/OrderRequest;)Lcom/kurum/order/domain/Order;" line="24">
        <counter type="INSTRUCTION" missed="22" covered="0"/>
        <counter type="BRANCH" missed="4" covered="0"/>
        <counter type="LINE" missed="7" covered="0"/>
        <counter type="COMPLEXITY" missed="3" covered="0"/>
        <counter type="METHOD" missed="1" covered="0"/>
      </method>
      <method name="findAll" desc="()Ljava/util/List;" line="40">
        <counter type="INSTRUCTION" missed="0" covered="5"/>
        <counter type="LINE" missed="0" covered="1"/>
        <counter type="COMPLEXITY" missed="0" covered="1"/>
        <counter type="METHOD" missed="0" covered="1"/>
      </method>
      <counter type="INSTRUCTION" missed="22" covered="11"/>
      <counter type="BRANCH" missed="4" covered="0"/>
      <counter type="LINE" missed="7" covered="3"/>
      <counter type="COMPLEXITY" missed="3" covered="2"/>
      <counter type="METHOD" missed="1" covered="2"/>
      <counter type="CLASS" missed="0" covered="1"/>
    </class>
    <class name="com/kurum/order/service/OrderService$Mode" sourcefilename="OrderService.java">
      <method name="values" desc="()[Lcom/kurum/order/service/OrderService$Mode;" line="60">
        <counter type="INSTRUCTION" missed="4" covered="0"/>
        <counter type="METHOD" missed="1" covered="0"/>
      </method>
      <counter type="INSTRUCTION" missed="4" covered="0"/>
      <counter type="METHOD" missed="1" covered="0"/>
    </class>
    <sourcefile name="OrderService.java">
      <line nr="18" mi="0" ci="3" mb="0" cb="0"/>
      <line nr="24" mi="5" ci="0" mb="2" cb="0"/>
      <line nr="25" mi="4" ci="0" mb="0" cb="0"/>
      <line nr="40" mi="0" ci="5" mb="1" cb="1"/>
      <counter type="INSTRUCTION" missed="26" covered="11"/>
      <counter type="BRANCH" missed="5" covered="1"/>
      <counter type="LINE" missed="7" covered="3"/>
      <counter type="COMPLEXITY" missed="4" covered="2"/>
      <counter type="METHOD" missed="2" covered="2"/>
    </sourcefile>
    <counter type="LINE" missed="7" covered="3"/>
  </package>
  <counter type="INSTRUCTION" missed="26" covered="11"/>
  <counter type="BRANCH" missed="5" covered="1"/>
  <counter type="LINE" missed="7" covered="3"/>
  <counter type="COMPLEXITY" missed="4" covered="2"/>
  <counter type="METHOD" missed="2" covered="2"/>
</report>`;

test('ratio treats "nothing to cover" as fully covered', () => {
  assert.equal(ratio({ missed: 0, covered: 0 }), 100);
  assert.equal(ratio({ missed: 1, covered: 3 }), 75);
  assert.equal(ratio({ missed: 4, covered: 0 }), 0);
});

test('addCounters sums every counter type', () => {
  const a = {
    instruction: { missed: 1, covered: 2 },
    branch: { missed: 3, covered: 4 },
    line: { missed: 5, covered: 6 },
    complexity: { missed: 7, covered: 8 },
    method: { missed: 9, covered: 10 }
  };
  const sum = addCounters(a, a);
  assert.deepEqual(sum.instruction, { missed: 2, covered: 4 });
  assert.deepEqual(sum.method, { missed: 18, covered: 20 });
});

test('parseJacocoXml skips the declaration, DOCTYPE and comments', () => {
  const report = parseJacocoXml(REPORT);
  assert.equal(report.name, 'order-service');
  assert.equal(report.classes.length, 2);
  assert.equal(report.sourceFiles.length, 1);
});

test('report level counters become the totals', () => {
  const { totals } = parseJacocoXml(REPORT);
  assert.deepEqual(totals.line, { missed: 7, covered: 3 });
  assert.deepEqual(totals.branch, { missed: 5, covered: 1 });
  assert.deepEqual(totals.method, { missed: 2, covered: 2 });
  assert.equal(Math.round(ratio(totals.line)), 30);
});

test('class metadata is split into package, qualified and simple names', () => {
  const cls = parseJacocoXml(REPORT).classes[0];
  assert.ok(cls);
  assert.equal(cls.internalName, 'com/kurum/order/service/OrderService');
  assert.equal(cls.qualifiedName, 'com.kurum.order.service.OrderService');
  assert.equal(cls.simpleName, 'OrderService');
  assert.equal(cls.packageName, 'com.kurum.order.service');
  assert.equal(cls.packagePath, 'com/kurum/order/service');
  assert.equal(cls.sourceFileName, 'OrderService.java');
  assert.deepEqual(cls.counters.branch, { missed: 4, covered: 0 });
});

test('methods carry their own counters, line and executed flag', () => {
  const methods = parseJacocoXml(REPORT).classes[0]?.methods ?? [];
  assert.equal(methods.length, 3);

  const create = methods.find((m) => m.name === 'create');
  assert.ok(create);
  assert.equal(create.line, 24);
  assert.equal(create.executed, false, 'METHOD sayacı covered=0 ise metot çalıştırılmamıştır');
  assert.deepEqual(create.counters.branch, { missed: 4, covered: 0 });

  const findAll = methods.find((m) => m.name === 'findAll');
  assert.equal(findAll?.executed, true);

  // XML varlıkları çözülür: &lt;init&gt; -> <init>
  assert.ok(methods.some((m) => m.name === '<init>'));
});

test('source file lines yield exact uncovered and partially covered line numbers', () => {
  const source = parseJacocoXml(REPORT).sourceFiles[0];
  assert.ok(source);
  assert.equal(source.relativePath, 'com/kurum/order/service/OrderService.java');
  assert.deepEqual(source.uncoveredLines, [24, 25], 'ci=0 && mi>0 olan satırlar');
  assert.deepEqual(source.partiallyCoveredLines, [40], 'çalışan ama dalı eksik satır');
  assert.deepEqual(source.counters.line, { missed: 7, covered: 3 });
});

test('inner classes are separate entries sharing the outer source file', () => {
  const inner = parseJacocoXml(REPORT).classes[1];
  assert.ok(inner);
  assert.equal(inner.simpleName, 'OrderService$Mode');
  assert.equal(inner.sourceFileName, 'OrderService.java');
});

test('describeSignature turns JVM descriptors into readable signatures', () => {
  assert.equal(
    describeSignature('create', '(Lcom/kurum/dto/OrderRequest;I)Lcom/kurum/domain/Order;'),
    'create(OrderRequest, int): Order'
  );
  assert.equal(describeSignature('save', '(Ljava/lang/String;)V'), 'save(String)');
  assert.equal(describeSignature('findAll', '()Ljava/util/List;'), 'findAll(): List');
  assert.equal(describeSignature('sum', '([I[[Ljava/lang/String;)J'), 'sum(int[], String[][]): long');
  assert.equal(describeSignature('<init>', '(Ljava/lang/String;)V', 'OrderService'), 'OrderService(String)');
  assert.equal(describeSignature('<clinit>', '()V'), 'static {}');
  assert.equal(describeSignature('inner', '(Lcom/x/Outer$Inner;)V'), 'inner(Inner)');
});

test('a self-closing class element with no methods is tolerated', () => {
  const xml =
    '<report name="r"><package name="p"><class name="p/A" sourcefilename="A.java"/>' +
    '<sourcefile name="A.java"><counter type="LINE" missed="3" covered="0"/></sourcefile></package></report>';

  const report = parseJacocoXml(xml);

  assert.equal(report.classes.length, 1);
  assert.deepEqual(report.classes[0]?.methods, []);
  assert.deepEqual(report.sourceFiles[0]?.counters.line, { missed: 3, covered: 0 });
});

test('a non-JaCoCo document is rejected with an actionable message', () => {
  assert.throws(
    () => parseJacocoXml('<?xml version="1.0"?><project><modelVersion>4.0.0</modelVersion></project>'),
    (err: unknown) => err instanceof JacocoParseError && /reportPath/.test(err.message)
  );
});

test('a DOCTYPE with an internal subset containing > is skipped correctly', () => {
  const xml =
    '<!DOCTYPE report [<!ENTITY x "a > b">]>' +
    '<report name="r"><counter type="LINE" missed="1" covered="1"/></report>';

  const report = parseJacocoXml(xml);

  assert.equal(report.name, 'r');
  assert.deepEqual(report.totals.line, { missed: 1, covered: 1 });
});
