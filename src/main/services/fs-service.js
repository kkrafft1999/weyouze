const { resolveDebugWaitMs } = require('../debug-wait');
const { sleepAbortable } = require('../providers/stream-helpers');

function createFsService({ fs, path, maxReadFileBytes }) {
  const MAX_READ_FILE_BYTES = maxReadFileBytes;

  /** true, wenn candidate (aufgelöst) innerhalb von root liegt — Root selbst zählt mit. */
  function containsPath(root, candidate) {
    const rel = path.relative(path.resolve(root), path.resolve(candidate));
    return !rel.startsWith('..') && !path.isAbsolute(rel);
  }

  function resolveWorkspacePath(workspaceRoot, relativePath) {
    const root = path.resolve(workspaceRoot);
    const raw = typeof relativePath === 'string' ? relativePath.trim() : '';
    const joined = path.resolve(root, raw.length ? raw : '.');
    if (!containsPath(root, joined)) {
      return { error: 'Pfad liegt außerhalb des Arbeitsordners.' };
    }
    return { absPath: joined };
  }

  function assertAbsolutePathInWorkspace(workspaceRoot, absPath) {
    if (!workspaceRoot) {
      return { error: 'Kein Arbeitsordner geöffnet.' };
    }
    const raw = typeof absPath === 'string' ? absPath.trim() : '';
    if (!raw) {
      return { error: 'Pfad ist erforderlich.' };
    }
    const resolved = path.resolve(raw);
    if (!containsPath(workspaceRoot, resolved)) {
      return { error: 'Pfad liegt außerhalb des Arbeitsordners.' };
    }
    return { absPath: resolved };
  }

  async function runWorkspaceTool(toolName, args, workspaceRoot, options = {}) {
    const { abortSignal } = options;
    if (toolName === 'debug_wait') {
      const ms = resolveDebugWaitMs(args);
      await sleepAbortable(ms, abortSignal);
      return JSON.stringify({ ok: true, waited_ms: ms, waited_seconds: ms / 1000 });
    }

    if (toolName === 'list_directory') {
      const relArg = args.relative_path;
      const rel = typeof relArg === 'string' ? relArg : '';
      const { absPath, error } = resolveWorkspacePath(workspaceRoot, rel);
      if (error) return JSON.stringify({ error });
      try {
        const st = await fs.stat(absPath);
        if (!st.isDirectory()) {
          return JSON.stringify({ error: 'Pfad ist kein Ordner.' });
        }
        const entries = await fs.readdir(absPath, { withFileTypes: true });
        const items = entries
          .filter((e) => !e.name.startsWith('.'))
          .map((e) => ({
            name: e.name,
            kind: e.isDirectory() ? 'directory' : 'file',
          }))
          .sort((a, b) => {
            if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
            return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
          });
        return JSON.stringify({ relative_path: rel || '.', items });
      } catch (e) {
        return JSON.stringify({ error: e.message });
      }
    }

    if (toolName === 'read_file_text') {
      const rel = typeof args.relative_path === 'string' ? args.relative_path.trim() : '';
      if (!rel) {
        return JSON.stringify({ error: 'relative_path ist erforderlich.' });
      }
      let maxChars = Number.isFinite(args.max_characters) ? Math.floor(args.max_characters) : 32000;
      maxChars = Math.min(Math.max(1000, maxChars), 200000);
      const { absPath, error } = resolveWorkspacePath(workspaceRoot, rel);
      if (error) return JSON.stringify({ error });
      try {
        const st = await fs.stat(absPath);
        if (st.isDirectory()) {
          return JSON.stringify({ error: 'Pfad ist ein Ordner, keine Datei.' });
        }
        if (st.size > MAX_READ_FILE_BYTES) {
          return JSON.stringify({
            error: `Datei zu groß (>${MAX_READ_FILE_BYTES} Bytes). Bitte andere Datei wählen.`,
          });
        }
        const buf = await fs.readFile(absPath);
        let text = buf.toString('utf8');
        const truncated = text.length > maxChars;
        if (truncated) {
          text = `${text.slice(0, maxChars)}\n… [gekürzt auf ${maxChars} Zeichen]`;
        }
        return JSON.stringify({
          relative_path: rel,
          size_bytes: st.size,
          truncated,
          content: text,
        });
      } catch (e) {
        return JSON.stringify({ error: e.message });
      }
    }

    return JSON.stringify({ error: `Unbekanntes Tool: ${toolName}` });
  }

  async function readDirectory(dirPath) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const items = await Promise.all(
      entries
        .filter((entry) => !entry.name.startsWith('.'))
        .map(async (entry) => {
          const fullPath = path.join(dirPath, entry.name);
          let stats = null;
          try {
            stats = await fs.stat(fullPath);
          } catch {
            // skip inaccessible files
          }
          return {
            name: entry.name,
            path: fullPath,
            isDirectory: entry.isDirectory(),
            size: stats ? stats.size : 0,
            modified: stats ? stats.mtimeMs : 0,
          };
        })
    );

    items.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    return items;
  }

  async function moveItem(sourcePath, destDir) {
    const srcStat = await fs.stat(sourcePath);
    const dstStat = await fs.stat(destDir);
    if (!dstStat.isDirectory()) {
      return { error: 'Ziel ist kein Ordner.' };
    }
    const baseName = path.basename(sourcePath);
    let targetPath = path.join(destDir, baseName);

    const srcParent = path.dirname(sourcePath);
    if (path.resolve(srcParent) === path.resolve(destDir)) {
      return { error: 'Quelle liegt bereits in diesem Ordner.' };
    }

    if (srcStat.isDirectory() && path.resolve(destDir).startsWith(path.resolve(sourcePath) + path.sep)) {
      return { error: 'Ordner kann nicht in sich selbst verschoben werden.' };
    }

    try {
      await fs.access(targetPath);
      const ext = path.extname(baseName);
      const nameNoExt = ext ? baseName.slice(0, -ext.length) : baseName;
      let i = 2;
      do {
        targetPath = path.join(destDir, `${nameNoExt} (${i})${ext}`);
        i++;
        try { await fs.access(targetPath); } catch { break; }
      } while (true);
    } catch {
      // target does not exist – good
    }

    await fs.rename(sourcePath, targetPath);
    return { ok: true, newPath: targetPath };
  }

  async function readFilePreview(filePath) {
    const stats = await fs.stat(filePath);
    const MAX_SIZE = 1024 * 1024; // 1 MB limit for preview
    if (stats.size > MAX_SIZE) {
      return { error: 'File too large for preview', size: stats.size };
    }
    const content = await fs.readFile(filePath, 'utf-8');
    return { content, size: stats.size, modified: stats.mtimeMs };
  }

  return {
    containsPath,
    resolveWorkspacePath,
    assertAbsolutePathInWorkspace,
    runWorkspaceTool,
    readDirectory,
    moveItem,
    readFilePreview,
  };
}

module.exports = {
  createFsService,
};
