/**
 * Global dirty-file registry.
 *
 * Components (LabScriptsPane) register the number of dirty files they manage.
 * App.jsx reads the registry to decide whether to warn on browser close
 * or whether a specific lab tab can be closed without confirmation.
 *
 * Usage:
 *   setDirtyCount('lab:4', 2);   // lab 4 has 2 dirty files
 *   setDirtyCount('lab:4', 0);   // lab 4 is clean
 *   removeDirtyCount('lab:4');    // lab 4 closed
 *   hasDirtyFiles()              // true if any lab has dirty files
 *   hasDirtyFilesForLab('4')     // true if lab 4 has dirty files
 */

const dirtyMap = new Map();

export function setDirtyCount(key, count) {
  if (count > 0) {
    dirtyMap.set(key, count);
  } else {
    dirtyMap.delete(key);
  }
}

export function removeDirtyCount(key) {
  dirtyMap.delete(key);
}

export function hasDirtyFiles() {
  for (const count of dirtyMap.values()) {
    if (count > 0) return true;
  }
  return false;
}

export function hasDirtyFilesForLab(labId) {
  return (dirtyMap.get(`lab:${labId}`) || 0) > 0;
}
