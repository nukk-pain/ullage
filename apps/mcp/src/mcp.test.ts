import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';

test('MCP stdio returns Invalid Request for JSON null and non-object input and negotiates the supported version', async () => {
  const script = `import { runMcpServer } from './src/mcp.ts'; runMcpServer({name:'test',version:'1',tools:[]});`;
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => { stdout += chunk; });
  child.stderr.on('data', (chunk: string) => { stderr += chunk; });

  const exit = new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
  child.stdin.end([
    'null',
    '42',
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 'unsupported-version' } })
  ].join('\n') + '\n');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
  try {
    assert.equal(await exit, 0, stderr);
    const replies = stdout.trim().split('\n').map((line) => JSON.parse(line) as { id: unknown; error?: { code: number }; result?: { protocolVersion: string } });
    assert.deepEqual(replies.slice(0, 2).map((reply) => reply.error?.code), [-32600, -32600]);
    assert.equal(replies[2]?.result?.protocolVersion, '2025-06-18');
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
});
