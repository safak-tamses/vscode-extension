import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMavenPath,
  mavenExecutableCandidates,
  quoteForShell,
  usesMaven
} from '../../src/coverage/maven';

// ------------------------------------------------------- mavenExecutableCandidates

test('candidates cover home, bin and direct file for a Windows Maven home', () => {
  const candidates = mavenExecutableCandidates('C:\\apache-maven-3.9.6', 'win32');
  assert.ok(candidates.includes('C:\\apache-maven-3.9.6\\bin\\mvn.cmd'));
  assert.ok(candidates.includes('C:\\apache-maven-3.9.6\\bin\\mvn.bat'));
  // bin varyantları doğrudan kök altındaki adlardan önce denenmeli.
  assert.ok(
    candidates.indexOf('C:\\apache-maven-3.9.6\\bin\\mvn.cmd') <
      candidates.indexOf('C:\\apache-maven-3.9.6\\mvn.cmd')
  );
});

test('candidates put the path itself first when it already names the executable', () => {
  const candidates = mavenExecutableCandidates('C:\\maven\\bin\\mvn.cmd', 'win32');
  assert.equal(candidates[0], 'C:\\maven\\bin\\mvn.cmd');
});

test('candidates handle a bin directory on POSIX', () => {
  const candidates = mavenExecutableCandidates('/opt/maven/bin', 'posix');
  assert.ok(candidates.includes('/opt/maven/bin/mvn'));
  assert.ok(candidates.includes('/opt/maven/bin/bin/mvn'));
});

test('candidates ignore trailing separators', () => {
  const candidates = mavenExecutableCandidates('C:\\apache-maven\\', 'win32');
  assert.ok(candidates.includes('C:\\apache-maven\\bin\\mvn.cmd'));
  assert.ok(!candidates.some((c) => c.includes('\\\\bin')));
});

test('candidates keep a custom wrapper file as a last resort', () => {
  const candidates = mavenExecutableCandidates('/opt/tools/maven-wrapper.sh', 'posix');
  assert.equal(candidates[candidates.length - 1], '/opt/tools/maven-wrapper.sh');
});

test('candidates are empty for an empty setting', () => {
  assert.deepEqual(mavenExecutableCandidates('', 'win32'), []);
  assert.deepEqual(mavenExecutableCandidates('   ', 'posix'), []);
});

// ------------------------------------------------------------------ quoteForShell

test('quoteForShell wraps Windows paths in double quotes', () => {
  assert.equal(quoteForShell('C:\\Program Files\\maven\\bin\\mvn.cmd', 'win32'), '"C:\\Program Files\\maven\\bin\\mvn.cmd"');
});

test('quoteForShell wraps POSIX paths in single quotes and escapes them', () => {
  assert.equal(quoteForShell('/opt/my maven/bin/mvn', 'posix'), "'/opt/my maven/bin/mvn'");
  assert.equal(quoteForShell("/opt/o'brien/mvn", 'posix'), "'/opt/o'\\''brien/mvn'");
});

// ----------------------------------------------------------------- applyMavenPath

test('applyMavenPath replaces the leading mvn token and keeps the arguments', () => {
  assert.equal(
    applyMavenPath('mvn -B clean install', 'C:\\maven\\bin\\mvn.cmd', 'win32'),
    '"C:\\maven\\bin\\mvn.cmd" -B clean install'
  );
});

test('applyMavenPath replaces mvn.cmd and mvn.bat tokens too', () => {
  assert.equal(
    applyMavenPath('mvn.cmd clean install', 'C:\\maven\\bin\\mvn.cmd', 'win32'),
    '"C:\\maven\\bin\\mvn.cmd" clean install'
  );
});

test('applyMavenPath preserves leading whitespace', () => {
  assert.equal(applyMavenPath('  mvn test', '/opt/maven/bin/mvn', 'posix'), "  '/opt/maven/bin/mvn' test");
});

test('applyMavenPath leaves non-Maven commands untouched', () => {
  assert.equal(applyMavenPath('./mvnw clean install', '/opt/maven/bin/mvn', 'posix'), './mvnw clean install');
  assert.equal(applyMavenPath('gradle build', '/opt/maven/bin/mvn', 'posix'), 'gradle build');
  // "mvnd" gibi farklı bir araç yanlışlıkla değiştirilmemeli.
  assert.equal(applyMavenPath('mvnd clean install', '/opt/maven/bin/mvn', 'posix'), 'mvnd clean install');
});

test('applyMavenPath is a no-op without an executable', () => {
  assert.equal(applyMavenPath('mvn clean install', '', 'posix'), 'mvn clean install');
});

test('applyMavenPath does not touch a bare mvn appearing later in the command', () => {
  assert.equal(
    applyMavenPath('echo mvn && mvn test', '/opt/maven/bin/mvn', 'posix'),
    'echo mvn && mvn test'
  );
});

// ----------------------------------------------------------------------- usesMaven

test('usesMaven detects Maven commands only', () => {
  assert.equal(usesMaven('mvn clean install'), true);
  assert.equal(usesMaven('  mvn.cmd -B test'), true);
  assert.equal(usesMaven('./mvnw clean install'), false);
  assert.equal(usesMaven('gradle build'), false);
});
