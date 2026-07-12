const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SRC_ROOT = path.join(__dirname, '..', 'src');
const APPLICATION_ROOT = path.join(SRC_ROOT, 'application');
const SHARED_ROOT = path.join(SRC_ROOT, 'shared');

// Keep the application core runtime-neutral. Add a built-in here only when its
// use is an explicit architecture decision; currently none are required.
const ALLOWED_NODE_BUILTINS = new Set();

function collectJsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectJsFiles(full));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

function extractRequires(source) {
  const matches = [];
  const patterns = [
    /require\(\s*['"]([^'"]+)['"]\s*\)/g,
    /import\s+[^'"]*['"]([^'"]+)['"]/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(source)) !== null) {
      matches.push(m[1]);
    }
  }
  return matches;
}

function resolveRequire(fromFile, req) {
  if (!req.startsWith('.')) return req;
  const base = path.resolve(path.dirname(fromFile), req);
  const candidates = [base, `${base}.js`, path.join(base, 'index.js')];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return path.normalize(candidate);
    }
  }
  return path.normalize(base);
}

function isUnderRoot(absPath, root) {
  const rel = path.relative(root, absPath);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

test('application layer imports only application/shared modules or allowed node built-ins', () => {
  const files = collectJsFiles(APPLICATION_ROOT);
  assert.ok(files.length > 0, 'expected application source files');

  const violations = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const req of extractRequires(source)) {
      if (!req.startsWith('.')) {
        if (!ALLOWED_NODE_BUILTINS.has(req)) {
          violations.push({
            file: path.relative(process.cwd(), file),
            require: req,
            reason: 'package or non-built-in import',
          });
        }
        continue;
      }

      const resolved = resolveRequire(file, req);
      const allowed = isUnderRoot(resolved, APPLICATION_ROOT) || isUnderRoot(resolved, SHARED_ROOT);
      if (!allowed) {
        violations.push({
          file: path.relative(process.cwd(), file),
          require: req,
          resolved: path.relative(SRC_ROOT, resolved).replace(/\\/g, '/'),
          reason: 'import outside application/shared',
        });
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `application layer import violations:\n${violations.map((v) => `${v.file} -> ${v.require} (${v.reason})`).join('\n')}`
  );
});
