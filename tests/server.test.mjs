import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../server.mjs';

async function request(url) {
  const result = {};
  await handleRequest({url}, {writeHead(status,headers){result.status=status;result.headers=headers;},end(body){result.body=body;}});
  return result;
}
test('serves the exact local app files with correct MIME and privacy headers', async () => {
  for (const [url,type] of [['/','text/html'],['/styles.css','text/css'],['/app.js','text/javascript'],['/audio.js','text/javascript'],['/progress.js','text/javascript'],['/lessons.js','text/javascript']]) {
    const response = await request(url);
    assert.equal(response.status,200);
    assert.ok(response.body.length>100);
    assert.ok(response.headers['Content-Type'].startsWith(type));
    assert.equal(response.headers['X-Content-Type-Options'],'nosniff');
    assert.match(response.headers['Content-Security-Policy'],/connect-src 'none'/);
    assert.match(response.headers['Content-Security-Policy'],/frame-ancestors 'none'/);
  }
});
test('does not expose source documentation, test files, arbitrary paths, or malformed URLs', async () => {
  for(const url of ['/README.md','/package.json','/tests/server.test.mjs','/../../etc/passwd','/not-found','/%ZZ']) {
    assert.equal((await request(url)).status,404,url);
  }
});
