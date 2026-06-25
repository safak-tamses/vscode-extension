import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, getNonce, getWebviewHtml } from '../../src/ui/html';

test('escapeHtml escapes all HTML-significant characters', () => {
  assert.equal(escapeHtml('<b>&"\''), '&lt;b&gt;&amp;&quot;&#39;');
});

test('escapeHtml leaves safe text untouched', () => {
  assert.equal(escapeHtml('java:S2095 close it'), 'java:S2095 close it');
});

test('getNonce returns a 32-char alphanumeric string', () => {
  const nonce = getNonce();
  assert.match(nonce, /^[A-Za-z0-9]{32}$/);
});

test('getNonce returns different values each call', () => {
  assert.notEqual(getNonce(), getNonce());
});

test('getWebviewHtml embeds CSP with nonce, locked default-src none, and resource URIs', () => {
  const html = getWebviewHtml({
    nonce: 'ABC123',
    cspSource: 'vscode-resource://x',
    scriptUri: 'vscode-resource://x/main.js',
    styleUri: 'vscode-resource://x/styles.css',
    title: 'Detay'
  });

  assert.match(html, /default-src 'none'/);
  assert.match(html, /script-src 'nonce-ABC123'/);
  assert.match(html, /style-src vscode-resource:\/\/x/);
  assert.ok(html.includes('vscode-resource://x/main.js'));
  assert.ok(html.includes('vscode-resource://x/styles.css'));
  assert.ok(html.includes('nonce="ABC123"'));
});

test('getWebviewHtml escapes the title to prevent injection', () => {
  const html = getWebviewHtml({
    nonce: 'N',
    cspSource: 'c',
    scriptUri: 's',
    styleUri: 'st',
    title: '<script>bad</script>'
  });

  assert.ok(!html.includes('<script>bad</script>'));
  assert.ok(html.includes('&lt;script&gt;bad&lt;/script&gt;'));
});
