const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { createFsService } = require('../src/main/services/fs-service');
const { registerFsHandlers } = require('../src/main/ipc/fs-handlers');
const { REQUEST_CHANNELS: REQ } = require('../src/shared/ipc-channels');
const { createMockIpcMain } = require('./helpers/mock-ipc');

async function setup(t) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'weyouze-fs-'));
  t.after(() => fs.rm(tmpDir, { recursive: true, force: true }));
  const workspace = path.join(tmpDir, 'workspace');
  const outside = path.join(tmpDir, 'outside');
  await fs.mkdir(workspace, { recursive: true });
  await fs.mkdir(outside, { recursive: true });
  await fs.writeFile(path.join(workspace, 'inside.txt'), 'inside', 'utf8');
  await fs.writeFile(path.join(outside, 'secret.txt'), 'secret', 'utf8');

  let activeWorkspaceRoot = workspace;
  const fsService = createFsService({ fs, path, maxReadFileBytes: 2 * 1024 * 1024 });
  const ipcMain = createMockIpcMain();
  registerFsHandlers({
    ipcMain,
    fsService,
    REQ,
    getActiveWorkspaceRoot: () => activeWorkspaceRoot,
  });
  return {
    ipcMain,
    workspace,
    outside,
    setWorkspace(root) {
      activeWorkspaceRoot = root;
    },
  };
}

test('readDirectory lists workspace entries and denies paths outside', async (t) => {
  const { ipcMain, workspace, outside } = await setup(t);

  const inside = await ipcMain.invoke(REQ.FS_READ_DIRECTORY, workspace);
  assert.deepEqual(inside.map((e) => e.name), ['inside.txt']);

  const denied = await ipcMain.invoke(REQ.FS_READ_DIRECTORY, outside);
  assert.deepEqual(denied, [], 'directories outside the workspace must not be listed');
});

test('readDirectory denies traversal via .. segments', async (t) => {
  const { ipcMain, workspace } = await setup(t);
  const sneaky = path.join(workspace, '..', 'outside');
  const denied = await ipcMain.invoke(REQ.FS_READ_DIRECTORY, sneaky);
  assert.deepEqual(denied, []);
});

test('readFile denies files outside the workspace and reads files inside', async (t) => {
  const { ipcMain, workspace, outside } = await setup(t);

  const ok = await ipcMain.invoke(REQ.FS_READ_FILE, path.join(workspace, 'inside.txt'));
  assert.equal(ok.content, 'inside');

  const denied = await ipcMain.invoke(REQ.FS_READ_FILE, path.join(outside, 'secret.txt'));
  assert.ok(denied.error, 'reading outside the workspace must fail');
  assert.equal(denied.content, undefined);
});

test('readFile denies prefix-sibling directories (workspace-evil trick)', async (t) => {
  const { ipcMain, workspace } = await setup(t);
  const sibling = `${workspace}-evil`;
  await fs.mkdir(sibling, { recursive: true });
  await fs.writeFile(path.join(sibling, 'x.txt'), 'x', 'utf8');
  const denied = await ipcMain.invoke(REQ.FS_READ_FILE, path.join(sibling, 'x.txt'));
  assert.ok(denied.error);
});

test('all handlers deny access when no workspace is open', async (t) => {
  const { ipcMain, workspace, setWorkspace } = await setup(t);
  setWorkspace(null);

  assert.deepEqual(await ipcMain.invoke(REQ.FS_READ_DIRECTORY, workspace), []);
  const read = await ipcMain.invoke(REQ.FS_READ_FILE, path.join(workspace, 'inside.txt'));
  assert.match(read.error, /Kein Arbeitsordner/);
  const move = await ipcMain.invoke(
    REQ.FS_MOVE_ITEM,
    path.join(workspace, 'inside.txt'),
    workspace
  );
  assert.match(move.error, /Kein Arbeitsordner/);
});

test('moveItem moves files within the workspace', async (t) => {
  const { ipcMain, workspace } = await setup(t);
  const destDir = path.join(workspace, 'sub');
  await fs.mkdir(destDir);

  const res = await ipcMain.invoke(REQ.FS_MOVE_ITEM, path.join(workspace, 'inside.txt'), destDir);
  assert.equal(res.ok, true);
  assert.equal(res.newPath, path.join(destDir, 'inside.txt'));
  assert.equal(await fs.readFile(res.newPath, 'utf8'), 'inside');
});

test('moveItem denies source or destination outside the workspace', async (t) => {
  const { ipcMain, workspace, outside } = await setup(t);

  const fromOutside = await ipcMain.invoke(
    REQ.FS_MOVE_ITEM,
    path.join(outside, 'secret.txt'),
    workspace
  );
  assert.ok(fromOutside.error, 'moving a file from outside the workspace must fail');

  const toOutside = await ipcMain.invoke(
    REQ.FS_MOVE_ITEM,
    path.join(workspace, 'inside.txt'),
    outside
  );
  assert.ok(toOutside.error, 'moving a file out of the workspace must fail');
  assert.equal(await fs.readFile(path.join(workspace, 'inside.txt'), 'utf8'), 'inside');
});
