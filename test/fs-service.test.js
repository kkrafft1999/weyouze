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

async function createSymlinkOrSkip(t, target, linkPath, type) {
  try {
    await fs.symlink(target, linkPath, type);
    return true;
  } catch (e) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(e.code)) {
      t.skip(`Symlinks werden auf dieser Plattform nicht unterstützt: ${e.code}`);
      return false;
    }
    throw e;
  }
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

test('read_file_text rejects a symlink to a file outside the workspace', async (t) => {
  const registry = makeToolRegistry();
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'weyouze-fs-'));
  t.after(() => fs.rm(tmpRoot, { recursive: true, force: true }));
  const workspace = path.join(tmpRoot, 'workspace');
  const outside = path.join(tmpRoot, 'outside');
  await fs.mkdir(workspace);
  await fs.mkdir(outside);
  const secret = path.join(outside, 'secret.txt');
  await fs.writeFile(secret, 'secret', 'utf8');
  const linked = await createSymlinkOrSkip(
    t,
    secret,
    path.join(workspace, 'secret-link.txt'),
    process.platform === 'win32' ? 'file' : undefined
  );
  if (!linked) return;

  const result = JSON.parse(
    await registry.execute(
      'read_file_text',
      { relative_path: 'secret-link.txt' },
      { workspaceRoot: workspace }
    )
  );

  assert.match(result.error, /außerhalb/);
  assert.equal(result.content, undefined);
});

test('list_directory rejects a symlink to a directory outside the workspace', async (t) => {
  const registry = makeToolRegistry();
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'weyouze-fs-'));
  t.after(() => fs.rm(tmpRoot, { recursive: true, force: true }));
  const workspace = path.join(tmpRoot, 'workspace');
  const outside = path.join(tmpRoot, 'outside');
  await fs.mkdir(workspace);
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'secret.txt'), 'secret', 'utf8');
  const linked = await createSymlinkOrSkip(
    t,
    outside,
    path.join(workspace, 'outside-link'),
    process.platform === 'win32' ? 'junction' : 'dir'
  );
  if (!linked) return;

  const result = JSON.parse(
    await registry.execute(
      'list_directory',
      { relative_path: 'outside-link' },
      { workspaceRoot: workspace }
    )
  );

  assert.match(result.error, /außerhalb/);
  assert.equal(result.items, undefined);
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

test('write_file_text rejects writes through a symlinked parent outside the workspace', async (t) => {
  const registry = makeToolRegistry();
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'weyouze-fs-'));
  t.after(() => fs.rm(tmpRoot, { recursive: true, force: true }));
  const workspace = path.join(tmpRoot, 'workspace');
  const outside = path.join(tmpRoot, 'outside');
  await fs.mkdir(workspace);
  await fs.mkdir(outside);
  const linked = await createSymlinkOrSkip(
    t,
    outside,
    path.join(workspace, 'outside-link'),
    process.platform === 'win32' ? 'junction' : 'dir'
  );
  if (!linked) return;

  const result = JSON.parse(
    await registry.execute(
      'write_file_text',
      { relative_path: 'outside-link/created.txt', content: 'must not escape' },
      { workspaceRoot: workspace, allowWrite: true }
    )
  );

  assert.match(result.error, /außerhalb/);
  await assert.rejects(fs.access(path.join(outside, 'created.txt')));
});

test('write_file_text rejects a dangling symlink instead of following it', async (t) => {
  const registry = makeToolRegistry();
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'weyouze-fs-'));
  t.after(() => fs.rm(tmpRoot, { recursive: true, force: true }));
  const workspace = path.join(tmpRoot, 'workspace');
  const outside = path.join(tmpRoot, 'outside');
  await fs.mkdir(workspace);
  await fs.mkdir(outside);
  const missingTarget = path.join(outside, 'created.txt');
  const linked = await createSymlinkOrSkip(
    t,
    missingTarget,
    path.join(workspace, 'dangling-link.txt'),
    process.platform === 'win32' ? 'file' : undefined
  );
  if (!linked) return;

  const result = JSON.parse(
    await registry.execute(
      'write_file_text',
      { relative_path: 'dangling-link.txt', content: 'must not escape' },
      { workspaceRoot: workspace, allowWrite: true }
    )
  );

  assert.ok(result.error);
  await assert.rejects(fs.access(missingTarget));
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

test('search_in_files finds matches with line numbers and context through the registry', async (t) => {
  const registry = makeToolRegistry();
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'weyouze-fs-'));
  t.after(() => fs.rm(tmpRoot, { recursive: true, force: true }));
  await fs.writeFile(
    path.join(tmpRoot, 'a.txt'),
    'zeile eins\nzeile zwei\nTREFFER hier\nzeile vier\nzeile fünf',
    'utf8'
  );
  await fs.mkdir(path.join(tmpRoot, 'sub'));
  await fs.writeFile(path.join(tmpRoot, 'sub', 'b.txt'), 'auch ein treffer', 'utf8');

  const out = JSON.parse(
    await registry.execute('search_in_files', { query: 'treffer' }, { workspaceRoot: tmpRoot })
  );

  assert.equal(out.error, undefined);
  // Groß-/Kleinschreibung wird standardmäßig ignoriert; Dateien vor Unterordnern.
  assert.deepEqual(out.matches, [
    {
      file: 'a.txt',
      line: 3,
      text: 'TREFFER hier',
      before: ['zeile eins', 'zeile zwei'],
      after: ['zeile vier', 'zeile fünf'],
    },
    {
      file: 'sub/b.txt',
      line: 1,
      text: 'auch ein treffer',
      before: [],
      after: [],
    },
  ]);
  assert.equal(out.files_scanned, 2);
  assert.equal(out.truncated, false);
  assert.equal(out.scan_limit_reached, false);
});

test('search_in_files supports regex, case_sensitive and context_lines', async (t) => {
  const registry = makeToolRegistry();
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'weyouze-fs-'));
  t.after(() => fs.rm(tmpRoot, { recursive: true, force: true }));
  await fs.writeFile(path.join(tmpRoot, 'a.txt'), 'foo1\nFOO2\nbar', 'utf8');

  const regex = JSON.parse(
    await registry.execute(
      'search_in_files',
      { query: 'foo\\d+', is_regex: true, case_sensitive: true, context_lines: 0 },
      { workspaceRoot: tmpRoot }
    )
  );
  assert.deepEqual(regex.matches, [
    { file: 'a.txt', line: 1, text: 'foo1', before: [], after: [] },
  ]);

  const literal = JSON.parse(
    await registry.execute(
      'search_in_files',
      { query: 'foo\\d+' },
      { workspaceRoot: tmpRoot }
    )
  );
  assert.deepEqual(literal.matches, []);
});

test('search_in_files rejects missing query and invalid regex', async (t) => {
  const registry = makeToolRegistry();
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'weyouze-fs-'));
  t.after(() => fs.rm(tmpRoot, { recursive: true, force: true }));

  const missing = JSON.parse(
    await registry.execute('search_in_files', {}, { workspaceRoot: tmpRoot })
  );
  assert.match(missing.error, /query/);

  const invalid = JSON.parse(
    await registry.execute(
      'search_in_files',
      { query: '(unclosed', is_regex: true },
      { workspaceRoot: tmpRoot }
    )
  );
  assert.match(invalid.error, /regulärer Ausdruck/i);
});

test('search_in_files respects workspace bounds', async (t) => {
  const registry = makeToolRegistry();
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'weyouze-fs-'));
  t.after(() => fs.rm(tmpRoot, { recursive: true, force: true }));

  const out = JSON.parse(
    await registry.execute(
      'search_in_files',
      { query: 'x', relative_path: '../outside' },
      { workspaceRoot: tmpRoot }
    )
  );
  assert.match(out.error, /außerhalb/);
});

test('search_in_files skips hidden entries by default, include_hidden enables them, .git stays excluded', async (t) => {
  const registry = makeToolRegistry();
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'weyouze-fs-'));
  t.after(() => fs.rm(tmpRoot, { recursive: true, force: true }));
  await fs.mkdir(path.join(tmpRoot, '.hidden'));
  await fs.writeFile(path.join(tmpRoot, '.hidden', 'h.txt'), 'geheimer treffer', 'utf8');
  await fs.mkdir(path.join(tmpRoot, '.git'));
  await fs.writeFile(path.join(tmpRoot, '.git', 'config'), 'git treffer', 'utf8');

  const withoutHidden = JSON.parse(
    await registry.execute('search_in_files', { query: 'treffer' }, { workspaceRoot: tmpRoot })
  );
  assert.deepEqual(withoutHidden.matches, []);

  const withHidden = JSON.parse(
    await registry.execute(
      'search_in_files',
      { query: 'treffer', include_hidden: true },
      { workspaceRoot: tmpRoot }
    )
  );
  assert.deepEqual(
    withHidden.matches.map((m) => m.file),
    ['.hidden/h.txt']
  );
});

test('search_in_files respects the root .gitignore including negation', async (t) => {
  const registry = makeToolRegistry();
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'weyouze-fs-'));
  t.after(() => fs.rm(tmpRoot, { recursive: true, force: true }));
  await fs.writeFile(
    path.join(tmpRoot, '.gitignore'),
    '# Kommentar\nignored-dir/\n*.log\n!keep.log\n',
    'utf8'
  );
  await fs.mkdir(path.join(tmpRoot, 'ignored-dir'));
  await fs.writeFile(path.join(tmpRoot, 'ignored-dir', 'x.txt'), 'treffer', 'utf8');
  await fs.writeFile(path.join(tmpRoot, 'debug.log'), 'treffer', 'utf8');
  await fs.writeFile(path.join(tmpRoot, 'keep.log'), 'treffer', 'utf8');
  await fs.writeFile(path.join(tmpRoot, 'normal.txt'), 'treffer', 'utf8');

  const out = JSON.parse(
    await registry.execute('search_in_files', { query: 'treffer' }, { workspaceRoot: tmpRoot })
  );
  assert.deepEqual(
    out.matches.map((m) => m.file),
    ['keep.log', 'normal.txt']
  );
});

test('search_in_files skips binary and oversized files', async (t) => {
  const svc = createFsService({ fs, path, maxReadFileBytes: 64, maxWriteFileBytes: 64 });
  const registry = makeToolRegistry(svc);
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'weyouze-fs-'));
  t.after(() => fs.rm(tmpRoot, { recursive: true, force: true }));
  await fs.writeFile(path.join(tmpRoot, 'binary.bin'), Buffer.from('tref\0fer treffer'));
  await fs.writeFile(path.join(tmpRoot, 'big.txt'), `treffer ${'x'.repeat(100)}`, 'utf8');
  await fs.writeFile(path.join(tmpRoot, 'small.txt'), 'treffer', 'utf8');

  const out = JSON.parse(
    await registry.execute('search_in_files', { query: 'treffer' }, { workspaceRoot: tmpRoot })
  );
  assert.deepEqual(
    out.matches.map((m) => m.file),
    ['small.txt']
  );
  assert.equal(out.files_scanned, 1);
});

test('search_in_files caps results at max_results and reports truncated', async (t) => {
  const registry = makeToolRegistry();
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'weyouze-fs-'));
  t.after(() => fs.rm(tmpRoot, { recursive: true, force: true }));
  await fs.writeFile(
    path.join(tmpRoot, 'a.txt'),
    Array.from({ length: 10 }, (_, i) => `treffer ${i}`).join('\n'),
    'utf8'
  );

  const out = JSON.parse(
    await registry.execute(
      'search_in_files',
      { query: 'treffer', max_results: 3 },
      { workspaceRoot: tmpRoot }
    )
  );
  assert.equal(out.matches.length, 3);
  assert.equal(out.truncated, true);
});

test('search_in_files stops after the scan limit and reports it', async (t) => {
  const svc = createFsService({
    fs,
    path,
    maxReadFileBytes: 1024 * 1024,
    maxWriteFileBytes: 1024 * 1024,
    maxSearchScannedFiles: 1,
  });
  const registry = makeToolRegistry(svc);
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'weyouze-fs-'));
  t.after(() => fs.rm(tmpRoot, { recursive: true, force: true }));
  await fs.writeFile(path.join(tmpRoot, 'a.txt'), 'treffer', 'utf8');
  await fs.writeFile(path.join(tmpRoot, 'b.txt'), 'treffer', 'utf8');

  const out = JSON.parse(
    await registry.execute('search_in_files', { query: 'treffer' }, { workspaceRoot: tmpRoot })
  );
  assert.deepEqual(
    out.matches.map((m) => m.file),
    ['a.txt']
  );
  assert.equal(out.scan_limit_reached, true);
});

test('search_in_files applies include and exclude globs', async (t) => {
  const registry = makeToolRegistry();
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'weyouze-fs-'));
  t.after(() => fs.rm(tmpRoot, { recursive: true, force: true }));
  await fs.mkdir(path.join(tmpRoot, 'src'));
  await fs.mkdir(path.join(tmpRoot, 'dist'));
  await fs.writeFile(path.join(tmpRoot, 'src', 'a.js'), 'treffer', 'utf8');
  await fs.writeFile(path.join(tmpRoot, 'src', 'a.md'), 'treffer', 'utf8');
  await fs.writeFile(path.join(tmpRoot, 'dist', 'b.js'), 'treffer', 'utf8');

  const included = JSON.parse(
    await registry.execute(
      'search_in_files',
      { query: 'treffer', include: '*.js' },
      { workspaceRoot: tmpRoot }
    )
  );
  assert.deepEqual(
    included.matches.map((m) => m.file),
    ['dist/b.js', 'src/a.js']
  );

  const excluded = JSON.parse(
    await registry.execute(
      'search_in_files',
      { query: 'treffer', include: '*.js', exclude: 'dist' },
      { workspaceRoot: tmpRoot }
    )
  );
  assert.deepEqual(
    excluded.matches.map((m) => m.file),
    ['src/a.js']
  );
});

test('search_in_files searches a single file when relative_path is a file', async (t) => {
  const registry = makeToolRegistry();
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'weyouze-fs-'));
  t.after(() => fs.rm(tmpRoot, { recursive: true, force: true }));
  await fs.writeFile(path.join(tmpRoot, 'a.txt'), 'treffer', 'utf8');
  await fs.writeFile(path.join(tmpRoot, 'b.txt'), 'treffer', 'utf8');

  const out = JSON.parse(
    await registry.execute(
      'search_in_files',
      { query: 'treffer', relative_path: 'a.txt' },
      { workspaceRoot: tmpRoot }
    )
  );
  assert.deepEqual(
    out.matches.map((m) => m.file),
    ['a.txt']
  );
});

test('search_in_files does not follow symlinks out of the workspace', async (t) => {
  const registry = makeToolRegistry();
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'weyouze-fs-'));
  t.after(() => fs.rm(tmpRoot, { recursive: true, force: true }));
  const workspace = path.join(tmpRoot, 'workspace');
  const outside = path.join(tmpRoot, 'outside');
  await fs.mkdir(workspace);
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'secret.txt'), 'geheimer treffer', 'utf8');
  const linked = await createSymlinkOrSkip(
    t,
    outside,
    path.join(workspace, 'outside-link'),
    process.platform === 'win32' ? 'junction' : 'dir'
  );
  if (!linked) return;

  const out = JSON.parse(
    await registry.execute('search_in_files', { query: 'treffer' }, { workspaceRoot: workspace })
  );
  assert.deepEqual(out.matches, []);
});

async function makeLinesFixture(t, lineCount = 10) {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'weyouze-fs-'));
  t.after(() => fs.rm(tmpRoot, { recursive: true, force: true }));
  const lines = Array.from({ length: lineCount }, (_, i) => `zeile ${i + 1}`);
  await fs.writeFile(path.join(tmpRoot, 'a.txt'), `${lines.join('\n')}\n`, 'utf8');
  return tmpRoot;
}

test('read_file_lines returns a numbered line range through the registry', async (t) => {
  const registry = makeToolRegistry();
  const tmpRoot = await makeLinesFixture(t);

  const out = JSON.parse(
    await registry.execute(
      'read_file_lines',
      { relative_path: 'a.txt', start_line: 3, end_line: 5 },
      { workspaceRoot: tmpRoot }
    )
  );
  assert.equal(out.content, '3\tzeile 3\n4\tzeile 4\n5\tzeile 5');
  assert.equal(out.start_line, 3);
  assert.equal(out.end_line, 5);
  assert.equal(out.total_lines, 10);
  assert.equal(out.truncated, false);
});

test('read_file_lines defaults to the file start and clamps end_line at EOF', async (t) => {
  const registry = makeToolRegistry();
  const tmpRoot = await makeLinesFixture(t);
  await fs.writeFile(path.join(tmpRoot, 'leer.txt'), '', 'utf8');

  const all = JSON.parse(
    await registry.execute('read_file_lines', { relative_path: 'a.txt' }, { workspaceRoot: tmpRoot })
  );
  assert.equal(all.start_line, 1);
  assert.equal(all.end_line, 10);
  assert.equal(all.truncated, false);
  assert.match(all.content, /^1\tzeile 1\n/);

  const clamped = JSON.parse(
    await registry.execute(
      'read_file_lines',
      { relative_path: 'a.txt', start_line: 8, end_line: 99 },
      { workspaceRoot: tmpRoot }
    )
  );
  assert.equal(clamped.end_line, 10);
  assert.equal(clamped.truncated, false);

  const empty = JSON.parse(
    await registry.execute('read_file_lines', { relative_path: 'leer.txt' }, { workspaceRoot: tmpRoot })
  );
  assert.equal(empty.total_lines, 0);
  assert.equal(empty.content, '');
});

test('read_file_lines validates range parameters', async (t) => {
  const registry = makeToolRegistry();
  const tmpRoot = await makeLinesFixture(t);
  const run = async (args) =>
    JSON.parse(await registry.execute('read_file_lines', { relative_path: 'a.txt', ...args }, { workspaceRoot: tmpRoot }));

  assert.match((await run({ start_line: 0 })).error, /start_line/);
  assert.match((await run({ start_line: 5, end_line: 3 })).error, /end_line/);
  assert.match((await run({ start_line: '3' })).error, /Ganzzahl/);
  assert.match((await run({ start_line: 42 })).error, /hinter dem Dateiende.*10 Zeilen/);
  assert.match((await run({ start_line: 1, start_byte: 0 })).error, /nicht beides/);
  const noPath = JSON.parse(await registry.execute('read_file_lines', {}, { workspaceRoot: tmpRoot }));
  assert.match(noPath.error, /relative_path/);
});

test('read_file_lines reads a byte range and reports the first line', async (t) => {
  const registry = makeToolRegistry();
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'weyouze-fs-'));
  t.after(() => fs.rm(tmpRoot, { recursive: true, force: true }));
  await fs.writeFile(path.join(tmpRoot, 'b.txt'), 'abc\ndef\nghi\n', 'utf8');

  const out = JSON.parse(
    await registry.execute(
      'read_file_lines',
      { relative_path: 'b.txt', start_byte: 4, length: 3 },
      { workspaceRoot: tmpRoot }
    )
  );
  assert.equal(out.content, 'def');
  assert.equal(out.first_line, 2);
  assert.equal(out.length, 3);
  assert.equal(out.size_bytes, 12);
  assert.equal(out.truncated, false);

  const tail = JSON.parse(
    await registry.execute(
      'read_file_lines',
      { relative_path: 'b.txt', start_byte: 8 },
      { workspaceRoot: tmpRoot }
    )
  );
  assert.equal(tail.content, 'ghi\n');
  assert.equal(tail.first_line, 3);

  const beyond = JSON.parse(
    await registry.execute(
      'read_file_lines',
      { relative_path: 'b.txt', start_byte: 100 },
      { workspaceRoot: tmpRoot }
    )
  );
  assert.match(beyond.error, /hinter dem Dateiende.*12 Bytes/);
});

test('read_file_lines respects workspace bounds and rejects directories', async (t) => {
  const registry = makeToolRegistry();
  const tmpRoot = await makeLinesFixture(t);

  const outside = JSON.parse(
    await registry.execute(
      'read_file_lines',
      { relative_path: '../outside.txt', start_line: 1 },
      { workspaceRoot: tmpRoot }
    )
  );
  assert.match(outside.error, /außerhalb/);

  const dir = JSON.parse(
    await registry.execute('read_file_lines', { relative_path: '.' }, { workspaceRoot: tmpRoot })
  );
  assert.match(dir.error, /Ordner/);
});

test('read_file_lines rejects a symlink to a file outside the workspace', async (t) => {
  const registry = makeToolRegistry();
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'weyouze-fs-'));
  t.after(() => fs.rm(tmpRoot, { recursive: true, force: true }));
  const workspace = path.join(tmpRoot, 'workspace');
  const outside = path.join(tmpRoot, 'outside');
  await fs.mkdir(workspace);
  await fs.mkdir(outside);
  const secret = path.join(outside, 'secret.txt');
  await fs.writeFile(secret, 'geheim\n', 'utf8');
  const linked = await createSymlinkOrSkip(
    t,
    secret,
    path.join(workspace, 'secret-link.txt'),
    process.platform === 'win32' ? 'file' : undefined
  );
  if (!linked) return;

  const result = JSON.parse(
    await registry.execute(
      'read_file_lines',
      { relative_path: 'secret-link.txt', start_line: 1 },
      { workspaceRoot: workspace }
    )
  );
  assert.match(result.error, /außerhalb/);
  assert.equal(result.content, undefined);
});

test('read_file_lines rejects oversized files and enforces the slice budget', async (t) => {
  const smallRead = createFsService({ fs, path, maxReadFileBytes: 16 });
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'weyouze-fs-'));
  t.after(() => fs.rm(tmpRoot, { recursive: true, force: true }));
  await fs.writeFile(path.join(tmpRoot, 'gross.txt'), 'x'.repeat(32), 'utf8');
  const tooBig = JSON.parse(
    await createWorkspaceToolRegistry({ fsService: smallRead }).execute(
      'read_file_lines',
      { relative_path: 'gross.txt' },
      { workspaceRoot: tmpRoot }
    )
  );
  assert.match(tooBig.error, /zu groß/);

  const smallSlice = createFsService({
    fs,
    path,
    maxReadFileBytes: 1024 * 1024,
    maxReadSliceChars: 20,
  });
  const registry = createWorkspaceToolRegistry({ fsService: smallSlice });
  await fs.writeFile(path.join(tmpRoot, 'a.txt'), 'zeile 1\nzeile 2\nzeile 3\n', 'utf8');
  const budgeted = JSON.parse(
    await registry.execute(
      'read_file_lines',
      { relative_path: 'a.txt', start_line: 1, end_line: 3 },
      { workspaceRoot: tmpRoot }
    )
  );
  assert.equal(budgeted.content, '1\tzeile 1\n2\tzeile 2');
  assert.equal(budgeted.end_line, 2);
  assert.equal(budgeted.truncated, true);

  const byteBudget = JSON.parse(
    await registry.execute(
      'read_file_lines',
      { relative_path: 'a.txt', start_byte: 0, length: 999 },
      { workspaceRoot: tmpRoot }
    )
  );
  assert.equal(byteBudget.length, 20);
  assert.equal(byteBudget.truncated, true);
});

test('read_file_lines caps the line span per call', async (t) => {
  const registry = makeToolRegistry();
  const tmpRoot = await makeLinesFixture(t, 1200);

  const out = JSON.parse(
    await registry.execute(
      'read_file_lines',
      { relative_path: 'a.txt', start_line: 1, end_line: 1200 },
      { workspaceRoot: tmpRoot }
    )
  );
  assert.equal(out.end_line, 1000);
  assert.equal(out.total_lines, 1200);
  assert.equal(out.truncated, true);
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
