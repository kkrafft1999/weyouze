/** Reine Hilfen für den Dateibaum (Phase 4.6.2 — Extraktion ohne DOM). */

export function folderDepthSortKey(dirPath) {
  return dirPath.split('/').filter(Boolean).length;
}

export function parentDirFromItemPath(itemPath) {
  const parts = itemPath.split('/');
  parts.pop();
  return parts.join('/') || '/';
}
