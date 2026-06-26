/**
 * Workdir resolution.
 *
 * Resolution precedence (highest first):
 *   1. --workdir flag
 *   2. CLOUDTRIK_HUB_WORKDIR env var
 *   3. Existing `.cloudtrik-hub/lock.json` in cwd (cwd has a workdir already)
 *   4. ~/.cloudtrik/skills (Cloudtrik workspace, if present)
 *   5. cwd (last-resort fallback)
 *
 * The resolved workdir is the directory under which `<dir>/<slug>/` lives.
 * The default subdirectory name is `skills`, overridable via --dir.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { stat } from 'node:fs/promises';

export interface ResolveWorkdirOpts {
  /** --workdir CLI flag value */
  workdir?: string;
  /** cwd at invocation time */
  cwd?: string;
}

export interface WorkdirResolution {
  workdir: string;
  source: 'flag' | 'env' | 'cwd-lock' | 'cloudtrik-home' | 'cwd';
}

/**
 * Resolve the workdir per the documented precedence.
 */
export async function resolveWorkdir(opts: ResolveWorkdirOpts = {}): Promise<WorkdirResolution> {
  const cwd = opts.cwd ?? process.cwd();
  const flagValue = opts.workdir?.trim();
  if (flagValue) return { workdir: flagValue, source: 'flag' };

  const envValue = process.env.CLOUDTRIK_HUB_WORKDIR?.trim();
  if (envValue) return { workdir: envValue, source: 'env' };

  if (await fileExists(join(cwd, '.cloudtrik-hub', 'lock.json'))) {
    return { workdir: cwd, source: 'cwd-lock' };
  }

  const home = homedir();
  const cloudtrikHome = join(home, '.cloudtrik');
  if (await dirExists(cloudtrikHome)) {
    return { workdir: cloudtrikHome, source: 'cloudtrik-home' };
  }

  return { workdir: cwd, source: 'cwd' };
}

/**
 * Compose the absolute skills sub-directory path. Default sub-dir is `skills`.
 */
export function skillsDir(workdir: string, dir: string = 'skills'): string {
  return join(workdir, dir);
}

/**
 * Compose the absolute install directory for a specific skill slug.
 */
export function skillInstallPath(workdir: string, slug: string, dir: string = 'skills'): string {
  return join(skillsDir(workdir, dir), slug);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
}

async function dirExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}
