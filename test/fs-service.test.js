const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { createFsService } = require('../src/main/services/fs-service');
const { createWorkspaceToolRegistry } = require('../src/main/tools/workspace-tool-registry');

function makeFsService() {
  return createFsService({ fs, path, maxReadFileBytes: 1024 * 1024, maxWriteFileBytes: 1024 * 1024 });
}

function makeToolRegistry(fsService = makeFsService()) {
  return createWorkspaceToolRegistry({ fsService });
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

test('resolveWorkspacePath requires an open workspace', () => {
  const svc = makeFsService();
  assert.match(svc.resolveWorkspacePath(null, 'note.txt').error, /Arbeitsordner/);
  assert.match(svc.resolveWorkspacePath('', 'note.txt').error, /Arbeitsordner/);
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

test('read_file_text respects workspace bounds through the registry', async () => {
  const registry = makeToolRegistry();
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'weyouze-fs-'));
  const nested = path.join(tmpRoot, 'nested');
  await fs.mkdir(nested);
  await fs.writeFile(path.join(nested, 'note.txt'), 'hello', 'utf8');

  const ok = JSON.parse(
    await registry.execute('read_file_text', { relative_path: 'nested/note.txt' }, { workspaceRoot: tmpRoot })
  );
  assert.equal(ok.content, 'hello');

  const bad = JSON.parse(
    await registry.execute('read_file_text', { relative_path: '../outside.txt' }, { workspaceRoot: tmpRoot })
  );
  assert.match(bad.error, /außerhalb/);

  await fs.rm(tmpRoot, { recursive: true, force: true });
});

test('list_directory lists directories before files and hides dotfiles', async () => {
  const registry = makeToolRegistry();
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'weyouze-fs-'));
  await fs.mkdir(path.join(tmpRoot, 'docs'));
  await fs.writeFile(path.join(tmpRoot, 'readme.md'), 'hello', 'utf8');
  await fs.writeFile(path.join(tmpRoot, '.secret'), 'hidden', 'utf8');

  const out = JSON.parse(
    await registry.execute('list_directory', { relative_path: '.' }, { workspaceRoot: tmpRoot })
  );

  assert.deepEqual(out.items, [
    { name: 'docs', kind: 'directory' },
    { name: 'readme.md', kind: 'file' },
  ]);

  await fs.rm(tmpRoot, { recursive: true, force: true });
});

test('debug_wait waits for the requested duration through the registry', async () => {
  const registry = makeToolRegistry();
  const started = Date.now();
  const out = JSON.parse(
    await registry.execute('debug_wait', { duration_seconds: 0.6 }, { workspaceRoot: '/tmp/project' })
  );
  const elapsed = Date.now() - started;
  assert.equal(out.ok, true);
  assert.equal(out.waited_ms, 600);
  assert.equal(out.waited_seconds, 0.6);
  assert.ok(elapsed >= 550);
});

test('write_file_text is disabled unless allowWrite is set', async () => {
  const registry = makeToolRegistry();
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'weyouze-fs-'));

  const denied = JSON.parse(
    await registry.execute(
      'write_file_text',
      { relative_path: 'note.txt', content: 'hi' },
      { workspaceRoot: tmpRoot }
    )
  );
  assert.match(denied.error, /Schreibzugriff ist deaktiviert/);
  await assert.rejects(fs.access(path.join(tmpRoot, 'note.txt')));

  await fs.rm(tmpRoot, { recursive: true, force: true });
});

test('write_file_text creates new files and reports created:true', async () => {
  const registry = makeToolRegistry();
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'weyouze-fs-'));

  const out = JSON.parse(
    await registry.execute(
      'write_file_text',
      { relative_path: 'nested/new/note.txt', content: 'hello world' },
      { workspaceRoot: tmpRoot, allowWrite: true }
    )
  );
  assert.equal(out.created, true);
  assert.equal(out.overwritten, false);
  assert.equal(out.bytes_written, Buffer.byteLength('hello world', 'utf8'));
  const written = await fs.readFile(path.join(tmpRoot, 'nested/new/note.txt'), 'utf8');
  assert.equal(written, 'hello world');

  await fs.rm(tmpRoot, { recursive: true, force: true });
});

test('write_file_text overwrites existing files and reports overwritten:true', async () => {
  const registry = makeToolRegistry();
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'weyouze-fs-'));
  await fs.writeFile(path.join(tmpRoot, 'existing.txt'), 'old', 'utf8');

  const out = JSON.parse(
    await registry.execute(
      'write_file_text',
      { relative_path: 'existing.txt', content: 'new content' },
      { workspaceRoot: tmpRoot, allowWrite: true }
    )
  );
  assert.equal(out.created, false);
  assert.equal(out.overwritten, true);
  const written = await fs.readFile(path.join(tmpRoot, 'existing.txt'), 'utf8');
  assert.equal(written, 'new content');

  await fs.rm(tmpRoot, { recursive: true, force: true });
});

test('write_file_text respects workspace bounds and rejects directory targets', async () => {
  const registry = makeToolRegistry();
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'weyouze-fs-'));
  await fs.mkdir(path.join(tmpRoot, 'adir'));

  const outside = JSON.parse(
    await registry.execute(
      'write_file_text',
      { relative_path: '../outside.txt', content: 'x' },
      { workspaceRoot: tmpRoot, allowWrite: true }
    )
  );
  assert.match(outside.error, /außerhalb/);

  const isDir = JSON.parse(
    await registry.execute(
      'write_file_text',
      { relative_path: 'adir', content: 'x' },
      { workspaceRoot: tmpRoot, allowWrite: true }
    )
  );
  assert.match(isDir.error, /Ordner/);

  const workspaceRoot = JSON.parse(
    await registry.execute(
      'write_file_text',
      { relative_path: '.', content: 'x' },
      { workspaceRoot: tmpRoot, allowWrite: true }
    )
  );
  assert.match(workspaceRoot.error, /Projektordner/);

  const missingContent = JSON.parse(
    await registry.execute(
      'write_file_text',
      { relative_path: 'a.txt' },
      { workspaceRoot: tmpRoot, allowWrite: true }
    )
  );
  assert.match(missingContent.error, /content/);

  await fs.rm(tmpRoot, { recursive: true, force: true });
});

test('write_file_text enforces the max content size', async () => {
  const svc = createFsService({ fs, path, maxReadFileBytes: 1024, maxWriteFileBytes: 10 });
  const registry = makeToolRegistry(svc);
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'weyouze-fs-'));

  const out = JSON.parse(
    await registry.execute(
      'write_file_text',
      { relative_path: 'big.txt', content: 'this is definitely more than ten bytes' },
      { workspaceRoot: tmpRoot, allowWrite: true }
    )
  );
  assert.match(out.error, /zu groß/);
  await assert.rejects(fs.access(path.join(tmpRoot, 'big.txt')));

  await fs.rm(tmpRoot, { recursive: true, force: true });
});

test('containsPath accepts the root itself and children, rejects siblings and traversal', () => {
  const path = require('path');
  const fs = require('fs/promises');
  const svc = createFsService({ fs, path, maxReadFileBytes: 1024 });
  assert.equal(svc.containsPath('/ws', '/ws'), true);
  assert.equal(svc.containsPath('/ws', '/ws/sub/file.txt'), true);
  assert.equal(svc.containsPath('/ws', '/ws/sub/../file.txt'), true);
  assert.equal(svc.containsPath('/ws', '/ws/../outside'), false);
  assert.equal(svc.containsPath('/ws', '/ws-evil/file.txt'), false);
  assert.equal(svc.containsPath('/ws', '/other'), false);
});
