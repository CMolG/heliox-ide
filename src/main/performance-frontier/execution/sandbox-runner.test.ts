import { describe, expect, it } from 'vitest';
import { runInSandbox } from './sandbox-runner';

describe('runInSandbox', () => {
  it('materializes files and the command can read them back', async () => {
    const result = await runInSandbox({
      vfsSnapshot: { '/workspace/hello.txt': 'hi-there' },
      command: 'node',
      args: ['-e', "process.stdout.write(require('fs').readFileSync('hello.txt','utf8'))"],
    });

    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.stdout).toContain('hi-there');
  });

  it('captures a non-zero exit code', async () => {
    const result = await runInSandbox({
      vfsSnapshot: {},
      command: 'node',
      args: ['-e', 'process.exit(3)'],
    });

    expect(result.exitCode).toBe(3);
    expect(result.timedOut).toBe(false);
  });

  it('enforces the timeout and kills the process', async () => {
    const start = Date.now();

    const result = await runInSandbox({
      vfsSnapshot: {},
      command: 'node',
      args: ['-e', 'setTimeout(()=>{}, 10000)'],
      timeoutMs: 300,
    });

    const elapsed = Date.now() - start;

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
    // Must return well under the 10 s the script would otherwise sleep.
    expect(elapsed).toBeLessThan(4_000);
  }, 10_000);

  it('materializes files in nested paths', async () => {
    const result = await runInSandbox({
      vfsSnapshot: { '/workspace/src/a/b.txt': 'nested-content' },
      command: 'node',
      args: [
        '-e',
        "process.stdout.write(require('fs').readFileSync(require('path').join('src','a','b.txt'),'utf8'))",
      ],
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('nested-content');
  });

  it('ignores snapshot entries outside the rootPrefix', async () => {
    const result = await runInSandbox({
      vfsSnapshot: {
        '/workspace/kept.txt': 'yes',
        '/other/ignored.txt': 'no',
      },
      command: 'node',
      args: [
        '-e',
        [
          "const fs = require('fs');",
          "const kept = fs.existsSync('kept.txt');",
          "const ignored = fs.existsSync('../other/ignored.txt');",
          "process.stdout.write(JSON.stringify({ kept, ignored }));",
        ].join(' '),
      ],
    });

    expect(result.exitCode).toBe(0);
    const out = JSON.parse(result.stdout) as { kept: boolean; ignored: boolean };
    expect(out.kept).toBe(true);
    expect(out.ignored).toBe(false);
  });

  it('merges custom env vars over process.env', async () => {
    const result = await runInSandbox({
      vfsSnapshot: {},
      command: 'node',
      args: ['-e', 'process.stdout.write(process.env.FLUXOR_TEST_VAR ?? "missing")'],
      env: { FLUXOR_TEST_VAR: 'injected-42' },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('injected-42');
  });

  it('uses options.cwd as the working directory within the materialized tree', async () => {
    const result = await runInSandbox({
      vfsSnapshot: { '/workspace/sub/data.txt': 'sub-content' },
      command: 'node',
      args: ['-e', "process.stdout.write(require('fs').readFileSync('data.txt','utf8'))"],
      cwd: 'sub',
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('sub-content');
  });

  it('captures stderr in the combined stdout field', async () => {
    const result = await runInSandbox({
      vfsSnapshot: {},
      command: 'node',
      args: ['-e', 'process.stderr.write("err-msg"); process.exit(1)'],
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('err-msg');
  });

  it('truncates large output to at most ~64KB', async () => {
    // Write 128 KB of 'x' characters to stdout.
    const result = await runInSandbox({
      vfsSnapshot: {},
      command: 'node',
      args: ['-e', "process.stdout.write('x'.repeat(128 * 1024))"],
    });

    expect(result.exitCode).toBe(0);
    expect(Buffer.byteLength(result.stdout, 'utf-8')).toBeLessThanOrEqual(64 * 1024);
    // The tail should be preserved (all 'x', no truncation marker at end).
    expect(result.stdout.at(-1)).toBe('x');
  });
});
