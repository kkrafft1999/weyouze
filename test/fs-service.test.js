const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { createFsService } = require('../src/main/services/fs-service');

function makeFsService() {
  return createFsService({ fs, path, maxReadFileBytes: 1024 * 1024 });
}

test('resolveWorkspacePath accepts paths inside workspace', () => {
  const svc = makeFsService();
  const root = '/tmp/project';
  assert.deepEqual(svc.resolveWorkspacePath(root, 'src/index.js'), {
    absPath: path.resolve(root, 'src/index.js'),
  });
  assert.deepEqual(svc.resolveWorkspacePath(root, ''), {
    absPath: path.resolve(root),
  });
});

test('resolveWorkspacePath rejects path traversal', () => {
  const svc = makeFsService();
  const root = '/tmp/project';
  assert.match(svc.resolveWorkspacePath(root, '../secret').error, /außerhalb/);
  assert.match(svc.resolveWorkspacePath(root, 'src/../../etc/passwd').error, /außerhalb/);
});

test('assertAbsolutePathInWorkspace requires open workspace', () => {
  const svc = makeFsService();
  assert.match(svc.assertAbsolutePathInWorkspace(null, '/tmp/x').error, /Arbeitsordner/);
});

test('assertAbsolutePathInWorkspace validates absolute paths', () => {
  const svc = makeFsService();
  const root = '/tmp/project';
  const inside = path.join(root, 'readme.md');
  assert.deepEqual(svc.assertAbsolutePathInWorkspace(root, inside), { absPath: inside });
  assert.match(
    svc.assertAbsolutePathInWorkspace(root, '/etc/passwd').error,
    /außerhalb/
  );
});

test('runWorkspaceTool read_file_text respects workspace bounds', async () => {
  const svc = makeFsService();
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'weyouze-fs-'));
  const nested = path.join(tmpRoot, 'nested');
  await fs.mkdir(nested);
  await fs.writeFile(path.join(nested, 'note.txt'), 'hello', 'utf8');

  const ok = JSON.parse(await svc.runWorkspaceTool('read_file_text', { relative_path: 'nested/note.txt' }, tmpRoot));
  assert.equal(ok.content, 'hello');

  const bad = JSON.parse(await svc.runWorkspaceTool('read_file_text', { relative_path: '../outside.txt' }, tmpRoot));
  assert.match(bad.error, /außerhalb/);

  await fs.rm(tmpRoot, { recursive: true, force: true });
});
