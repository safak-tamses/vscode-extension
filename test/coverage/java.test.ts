import { test } from 'node:test';
import assert from 'node:assert/strict';
import { javaExecutableRelPath, javaHomeCandidates, withJavaHome } from '../../src/coverage/java';

// ------------------------------------------------------------ javaHomeCandidates

test('javaHomeCandidates accepts a JDK home as-is', () => {
  assert.deepEqual(javaHomeCandidates('C:\\jdk-17', 'win32'), ['C:\\jdk-17']);
});

test('javaHomeCandidates climbs up from bin/java', () => {
  const candidates = javaHomeCandidates('C:\\jdk-17\\bin\\java.exe', 'win32');
  assert.equal(candidates[0], 'C:\\jdk-17');
});

test('javaHomeCandidates climbs up from a bin directory', () => {
  const candidates = javaHomeCandidates('/usr/lib/jvm/jdk-17/bin', 'posix');
  assert.equal(candidates[0], '/usr/lib/jvm/jdk-17');
});

test('javaHomeCandidates offers the macOS bundle layout', () => {
  const candidates = javaHomeCandidates('/Library/Java/JavaVirtualMachines/jdk-17.jdk', 'posix');
  assert.ok(candidates.includes('/Library/Java/JavaVirtualMachines/jdk-17.jdk/Contents/Home'));
});

test('javaHomeCandidates ignores trailing separators and empty input', () => {
  assert.deepEqual(javaHomeCandidates('C:\\jdk-17\\', 'win32'), ['C:\\jdk-17']);
  assert.deepEqual(javaHomeCandidates('', 'posix'), []);
  assert.deepEqual(javaHomeCandidates('  ', 'win32'), []);
});

test('javaExecutableRelPath is platform specific', () => {
  assert.equal(javaExecutableRelPath('win32'), 'bin\\java.exe');
  assert.equal(javaExecutableRelPath('posix'), 'bin/java');
});

// ------------------------------------------------------------------ withJavaHome

test('withJavaHome sets JAVA_HOME and prepends bin to PATH', () => {
  const env = withJavaHome({ PATH: '/usr/bin:/bin' }, '/opt/jdk-17', 'posix');
  assert.equal(env['JAVA_HOME'], '/opt/jdk-17');
  assert.equal(env['PATH'], '/opt/jdk-17/bin:/usr/bin:/bin');
});

test('withJavaHome uses the Windows separator and list separator', () => {
  const env = withJavaHome({ Path: 'C:\\Windows' }, 'C:\\jdk-17', 'win32');
  assert.equal(env['JAVA_HOME'], 'C:\\jdk-17');
  assert.equal(env['Path'], 'C:\\jdk-17\\bin;C:\\Windows');
});

test('withJavaHome reuses the existing PATH key casing on Windows', () => {
  const env = withJavaHome({ PATH: 'C:\\Windows' }, 'C:\\jdk-17', 'win32');
  assert.equal(env['PATH'], 'C:\\jdk-17\\bin;C:\\Windows');
  assert.equal(env['Path'], undefined);
});

test('withJavaHome creates PATH when the environment has none', () => {
  const env = withJavaHome({}, '/opt/jdk-17', 'posix');
  assert.equal(env['PATH'], '/opt/jdk-17/bin');
});

test('withJavaHome does not mutate the input environment', () => {
  const original = { PATH: '/usr/bin' };
  withJavaHome(original, '/opt/jdk-17', 'posix');
  assert.deepEqual(original, { PATH: '/usr/bin' });
});
