import { promises as fs } from 'fs';
import path from 'path';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item));
  }
  if (isPlainObject(value)) {
    const out = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = cloneValue(nested);
    }
    return out;
  }
  return value;
}

/**
 * Deep merge two JSON values with special array behavior:
 * - object + object: recursive merge
 * - array + array: concatenate
 * - otherwise: override wins
 */
export function deepMergeEnvironment(baseValue, overrideValue) {
  if (Array.isArray(baseValue) && Array.isArray(overrideValue)) {
    return [
      ...baseValue.map((item) => cloneValue(item)),
      ...overrideValue.map((item) => cloneValue(item)),
    ];
  }

  if (isPlainObject(baseValue) && isPlainObject(overrideValue)) {
    const merged = {};

    for (const [key, value] of Object.entries(baseValue)) {
      merged[key] = cloneValue(value);
    }

    for (const [key, value] of Object.entries(overrideValue)) {
      if (Object.prototype.hasOwnProperty.call(merged, key)) {
        merged[key] = deepMergeEnvironment(merged[key], value);
      } else {
        merged[key] = cloneValue(value);
      }
    }

    return merged;
  }

  return cloneValue(overrideValue);
}

function isInsideOrSame(rootPath, targetPath) {
  const rel = path.relative(rootPath, targetPath);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function getDirectoryChainToRoot(startDir, rootDir) {
  const start = path.resolve(startDir);
  const root = path.resolve(rootDir);

  if (!isInsideOrSame(root, start)) {
    throw new Error(`Source path is outside labs root: ${start}`);
  }

  const chain = [];
  let current = start;

  while (true) {
    chain.push(current);
    if (current === root) break;

    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`Cannot reach labs root from source path: ${start}`);
    }
    current = parent;
  }

  return chain;
}

export async function mergeEnvironmentJsonHierarchy({ sourceFilePath, labsRoot }) {
  const sourceAbs = path.resolve(sourceFilePath);
  const sourceDir = path.dirname(sourceAbs);
  const chainBottomUp = getDirectoryChainToRoot(sourceDir, labsRoot);

  const loadedFiles = [];
  let merged = {};

  // Merge from labs root down to source dir so closer files override older values.
  for (const dir of [...chainBottomUp].reverse()) {
    const envPath = path.join(dir, 'environment.json');
    let raw;

    try {
      raw = await fs.readFile(envPath, 'utf-8');
    } catch (err) {
      if (err.code === 'ENOENT') continue;
      throw err;
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(`Invalid JSON in ${envPath}: ${err.message}`);
    }

    if (!isPlainObject(parsed)) {
      throw new Error(`Environment file must contain a JSON object: ${envPath}`);
    }

    merged = deepMergeEnvironment(merged, parsed);
    loadedFiles.push(envPath);
  }

  return { merged, loadedFiles };
}

/**
 * Build and write a runtime env file for a source workflow/script.
 */
export async function writeRuntimeEnvironmentFile({
  sourceFilePath,
  labsRoot,
  outputFilePath,
}) {
  const { merged, loadedFiles } = await mergeEnvironmentJsonHierarchy({
    sourceFilePath,
    labsRoot,
  });

  await fs.mkdir(path.dirname(outputFilePath), { recursive: true });
  await fs.writeFile(outputFilePath, JSON.stringify(merged, null, 2), 'utf-8');

  return {
    outputFilePath,
    loadedFiles,
  };
}
