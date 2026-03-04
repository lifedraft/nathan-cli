/**
 * Shared require function for n8n module resolution.
 *
 * When nathan is installed as a global package (`bun install -g nathan`),
 * n8n-nodes-base is a dependency in the same node_modules tree and resolves
 * normally via createRequire(import.meta.url).
 *
 * When running from a standalone script or different location, this module
 * also searches common global install paths as a fallback.
 */

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';

function findGlobalNodeModules(): string[] {
  const home = homedir();
  const candidates = [
    // bun
    join(home, '.bun', 'install', 'global', 'node_modules'),
    // npm (macOS/Linux)
    '/usr/local/lib/node_modules',
    '/usr/lib/node_modules',
    join(home, '.npm-global', 'lib', 'node_modules'),
    // pnpm
    join(home, '.local', 'share', 'pnpm', 'global', 'node_modules'),
    // yarn
    join(home, '.config', 'yarn', 'global', 'node_modules'),
  ];

  const nodePath = process.env.NODE_PATH;
  if (nodePath) {
    for (const p of nodePath.split(':')) {
      if (p) candidates.unshift(p);
    }
  }

  return candidates.filter((p) => existsSync(p));
}

let _require: NodeRequire | undefined;

/**
 * Get a require function that can resolve n8n packages.
 *
 * Resolution order:
 * 1. import.meta.url (works when nathan is installed as a package)
 * 2. cwd-based (works when run from a project with n8n-nodes-base)
 * 3. Global install paths (bun, npm, pnpm, yarn)
 */
export function getRequire(): NodeRequire {
  if (_require) return _require;

  // Try import.meta.url first (package install / dev mode)
  const metaRequire = createRequire(import.meta.url);
  try {
    metaRequire.resolve('n8n-nodes-base/package.json');
    _require = metaRequire;
    return _require;
  } catch {
    // not available from import.meta.url
  }

  // Try cwd
  const cwdRequire = createRequire(join(process.cwd(), '_nathan_resolve_.js'));
  try {
    cwdRequire.resolve('n8n-nodes-base/package.json');
    _require = cwdRequire;
    return _require;
  } catch {
    // not available from cwd
  }

  // Search global install paths
  for (const dir of findGlobalNodeModules()) {
    const pkgPath = join(dir, 'n8n-nodes-base', 'package.json');
    if (existsSync(pkgPath)) {
      _require = createRequire(join(dir, '_nathan_resolve_.js'));
      return _require;
    }
  }

  // Last resort
  _require = metaRequire;
  return _require;
}
