import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SonarClient, SonarApiError } from '../../src/sonar/client';
import type { HttpClient, SonarConfig } from '../../src/sonar/client';

const cfg: SonarConfig = {
  baseUrl: 'https://sonar.local',
  projectKey: 'my-proj',
  branch: 'main',
  authScheme: 'bearer'
};

class FakeHttp implements HttpClient {
  public calls: Array<{ url: string; headers: Record<string, string> }> = [];
  private queue: Array<{ status: number; body: string }>;
  constructor(responses: Array<{ status: number; body: string }>) {
    this.queue = [...responses];
  }
  async get(url: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
    this.calls.push({ url, headers });
    return this.queue.shift() ?? { status: 200, body: '{}' };
  }
}

function issueBody(keys: string[], total = keys.length, p = 1, ps = 100): string {
  return JSON.stringify({
    total,
    p,
    ps,
    issues: keys.map((key) => ({
      key,
      rule: 'java:S2095',
      severity: 'MAJOR',
      type: 'BUG',
      component: 'my-proj:src/Foo.java',
      project: 'my-proj',
      line: 42,
      message: 'Use try-with-resources',
      status: 'OPEN',
      textRange: { startLine: 42, endLine: 42, startOffset: 2, endOffset: 10 }
    }))
  });
}

test('searchIssues builds correct URL + Bearer header and parses issues', async () => {
  const http = new FakeHttp([{ status: 200, body: issueBody(['AY-1']) }]);
  const client = new SonarClient(http, async () => 'TOKEN123', cfg);

  const page = await client.searchIssues();

  assert.equal(http.calls.length, 1);
  assert.equal(
    http.calls[0]?.url,
    'https://sonar.local/api/issues/search?componentKeys=my-proj&resolved=false&ps=100&p=1&branch=main'
  );
  assert.equal(http.calls[0]?.headers['Authorization'], 'Bearer TOKEN123');
  assert.equal(page.total, 1);
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0]?.rule, 'java:S2095');
  assert.equal(page.items[0]?.textRange?.startLine, 42);
});

test('maps 401 to SonarApiError with token guidance', async () => {
  const http = new FakeHttp([{ status: 401, body: '{"errors":[{"msg":"Insufficient privileges"}]}' }]);
  const client = new SonarClient(http, async () => 'BAD', cfg);

  await assert.rejects(
    () => client.searchIssues(),
    (err: unknown) => {
      assert.ok(err instanceof SonarApiError);
      assert.equal((err as SonarApiError).status, 401);
      assert.match((err as SonarApiError).message, /token/i);
      return true;
    }
  );
});

test('uses Basic auth header when authScheme is basic', async () => {
  const http = new FakeHttp([{ status: 200, body: issueBody([], 0) }]);
  const client = new SonarClient(http, async () => 'TOK', { ...cfg, authScheme: 'basic' });

  await client.searchIssues();

  const expected = 'Basic ' + Buffer.from('TOK:').toString('base64');
  assert.equal(http.calls[0]?.headers['Authorization'], expected);
});

test('searchAllIssues paginates until total reached', async () => {
  const http = new FakeHttp([
    { status: 200, body: issueBody(['a', 'b'], 3, 1, 2) },
    { status: 200, body: issueBody(['c'], 3, 2, 2) }
  ]);
  const client = new SonarClient(http, async () => 'T', cfg);

  const all = await client.searchAllIssues(100, 2);

  assert.equal(http.calls.length, 2);
  assert.deepEqual(all.map((i) => i.key), ['a', 'b', 'c']);
});

test('searchAllIssues stops at cap', async () => {
  const http = new FakeHttp([
    { status: 200, body: issueBody(['a', 'b'], 10, 1, 2) },
    { status: 200, body: issueBody(['c', 'd'], 10, 2, 2) }
  ]);
  const client = new SonarClient(http, async () => 'T', cfg);

  const all = await client.searchAllIssues(3, 2);

  assert.equal(all.length, 3);
});

test('validateConnection returns ok on valid token', async () => {
  const http = new FakeHttp([{ status: 200, body: '{"valid":true}' }]);
  const client = new SonarClient(http, async () => 'T', cfg);

  const res = await client.validateConnection();

  assert.equal(res.ok, true);
  assert.equal(http.calls[0]?.url, 'https://sonar.local/api/authentication/validate');
});

test('validateConnection returns not ok on 401 (no throw)', async () => {
  const http = new FakeHttp([{ status: 401, body: '{"errors":[{"msg":"no"}]}' }]);
  const client = new SonarClient(http, async () => 'BAD', cfg);

  const res = await client.validateConnection();

  assert.equal(res.ok, false);
  assert.ok(res.detail && res.detail.length > 0);
});

test('showRule fetches and parses rule (key encoded)', async () => {
  const http = new FakeHttp([
    {
      status: 200,
      body: JSON.stringify({
        rule: {
          key: 'java:S2095',
          name: 'Resources should be closed',
          htmlDesc: '<p>Close it</p>',
          severity: 'MAJOR',
          type: 'BUG'
        }
      })
    }
  ]);
  const client = new SonarClient(http, async () => 'T', cfg);

  const rule = await client.showRule('java:S2095');

  assert.equal(http.calls[0]?.url, 'https://sonar.local/api/rules/show?key=java%3AS2095');
  assert.equal(rule.name, 'Resources should be closed');
  assert.equal(rule.htmlDesc, '<p>Close it</p>');
});

test('searchHotspots parses paging object', async () => {
  const http = new FakeHttp([
    {
      status: 200,
      body: JSON.stringify({
        paging: { total: 1, pageIndex: 1, pageSize: 100 },
        hotspots: [
          {
            key: 'h1',
            component: 'my-proj:src/A.java',
            project: 'my-proj',
            securityCategory: 'sql-injection',
            vulnerabilityProbability: 'HIGH',
            line: 10,
            message: 'risk'
          }
        ]
      })
    }
  ]);
  const client = new SonarClient(http, async () => 'T', cfg);

  const page = await client.searchHotspots();

  assert.equal(
    http.calls[0]?.url,
    'https://sonar.local/api/hotspots/search?projectKey=my-proj&ps=100&p=1&branch=main'
  );
  assert.equal(page.total, 1);
  assert.equal(page.items[0]?.securityCategory, 'sql-injection');
});

test('findIssue queries by issue key and returns the issue or undefined', async () => {
  const http = new FakeHttp([
    { status: 200, body: issueBody(['ISSUE-9']) },
    { status: 200, body: issueBody([], 0) }
  ]);
  const client = new SonarClient(http, async () => 'T', cfg);

  const found = await client.findIssue('ISSUE-9');
  assert.equal(found?.key, 'ISSUE-9');
  assert.equal(http.calls[0]?.url, 'https://sonar.local/api/issues/search?issues=ISSUE-9&ps=1&p=1');

  const missing = await client.findIssue('NOPE');
  assert.equal(missing, undefined);
});

test('normalizes baseUrl trailing slash', async () => {
  const http = new FakeHttp([{ status: 200, body: issueBody([], 0) }]);
  const client = new SonarClient(http, async () => 'T', { ...cfg, baseUrl: 'https://sonar.local/' });

  await client.searchIssues();

  assert.ok(http.calls[0]?.url.startsWith('https://sonar.local/api/issues/search'));
});
