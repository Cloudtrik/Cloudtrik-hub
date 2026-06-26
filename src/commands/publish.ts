/**
 * `cloudtrik-hub publish <path> --slug <slug> --name <name> --version <v> [--changelog <t>] [--tags <csv>]`
 *
 * Publishes a skill folder to the registry as a new version.
 *
 * Flow:
 *   1. Validate path contains a SKILL.md
 *   2. Pack the folder into a .tgz tarball honoring .gitignore
 *   3. POST /api/cli/upload-url → receive presigned PUT URL
 *   4. PUT the tarball to the presigned URL
 *   5. POST /api/cli/publish with metadata to finalize
 *
 * Auth: REQUIRED
 *
 * Exit codes:
 *   0 = published
 *   1 = HTTP error
 *   2 = auth missing
 *   3 = invalid semver
 *   4 = file structure invalid (no SKILL.md)
 */

import type { Command } from 'commander';
import semver from 'semver';
import ignore from 'ignore';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { type } from 'arktype';
import { ApiRoutes } from '../registry/routes.js';
import { resolveRegistry } from '../registry/discovery.js';
import { postJson, registryRequest } from '../registry/client.js';
import { packDirectory } from '../util/tar.js';
import { readConfig } from '../auth/config.js';
import { CliError } from '../util/errors.js';
import { info } from '../util/ui.js';
import { UploadUrlResponseSchema } from '../registry/types.js';

interface GlobalOpts {
  site?: string;
  registry?: string;
}

interface PublishOpts {
  slug: string;
  name: string;
  version: string;
  changelog?: string;
  tags?: string;
}

export function cmdPublish(program: Command): void {
  program
    .command('publish')
    .description('Publish a skill folder to the Cloudtrik registry')
    .argument('<path>', 'Path to the skill folder')
    .requiredOption('--slug <slug>', 'Skill slug')
    .requiredOption('--name <name>', 'Display name')
    .requiredOption('--version <v>', 'Version (semver)')
    .option('--changelog <text>', 'Changelog entry for this version')
    .option('--tags <csv>', 'Comma-separated tags (default: latest)', 'latest')
    .action(async (path: string, opts: PublishOpts, cmd) => {
      const globalOpts = (cmd.parent?.opts() ?? {}) as GlobalOpts;
      const cfg = await readConfig();
      if (!cfg.token) {
        throw new CliError('No auth token. Run `cloudtrik-hub login` first.', 2);
      }
      if (!semver.valid(opts.version)) {
        throw new CliError(`Invalid semver: ${opts.version}`, 3);
      }
      const skillRoot = resolve(path);
      const skillMdPath = join(skillRoot, 'SKILL.md');
      try {
        const skillStat = await stat(skillMdPath);
        if (!skillStat.isFile()) {
          throw new CliError(`Expected SKILL.md file at ${skillMdPath}`, 4);
        }
      } catch (err) {
        if (err instanceof CliError) throw err;
        throw new CliError(`SKILL.md missing at ${skillMdPath}`, 4);
      }

      // Compose ignore filter from .gitignore if present.
      const ig = ignore();
      try {
        const gitignoreContents = await readFile(join(skillRoot, '.gitignore'), 'utf8');
        ig.add(gitignoreContents);
      } catch {
        // .gitignore absent — pack everything except hard-coded excludes.
      }
      ig.add(['node_modules/', '.git/', 'dist/', '*.tgz']);
      const filter = (rel: string): boolean => {
        if (rel === '' || rel === '.') return false;
        return ig.ignores(rel);
      };

      info(`Packing ${skillRoot}…`);
      const tarballBytes = await packDirectory(skillRoot, filter);
      info(`Tarball size: ${tarballBytes.byteLength} bytes`);

      const resolved = await resolveRegistry({
        site: globalOpts.site,
        registry: globalOpts.registry,
        cachedRegistry: cfg.registry,
      });

      info('Requesting upload URL…');
      const uploadRes = await postJson(
        resolved.apiBase,
        ApiRoutes.cliUploadUrl,
        { slug: opts.slug, version: opts.version },
        cfg.token,
      );
      if (uploadRes.statusCode !== 200) {
        throw new CliError(`Failed to obtain upload URL: HTTP ${uploadRes.statusCode}`, 1);
      }
      const parsed = UploadUrlResponseSchema(uploadRes.data);
      if (parsed instanceof type.errors) {
        throw new CliError(`Registry returned unexpected upload-url shape`, 1);
      }

      info('Uploading tarball…');
      const putRes = await registryRequest(parsed.uploadUrl, {
        method: 'PUT',
        path: '',
        body: tarballBytes,
        contentType: 'application/octet-stream',
        headers: parsed.uploadHeaders as Record<string, string> | undefined,
      });
      if (putRes.statusCode < 200 || putRes.statusCode >= 300) {
        await putRes.body.dump();
        throw new CliError(`Tarball upload failed: HTTP ${putRes.statusCode}`, 1);
      }
      await putRes.body.dump();

      info('Finalizing publish…');
      const tagList = opts.tags
        ? opts.tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
        : ['latest'];
      const publishRes = await postJson(
        resolved.apiBase,
        ApiRoutes.cliPublish,
        {
          slug: opts.slug,
          name: opts.name,
          version: opts.version,
          ...(opts.changelog ? { changelog: opts.changelog } : {}),
          tags: tagList,
          ...(parsed.uploadId ? { uploadId: parsed.uploadId } : {}),
        },
        cfg.token,
      );
      if (publishRes.statusCode < 200 || publishRes.statusCode >= 300) {
        throw new CliError(`Publish failed: HTTP ${publishRes.statusCode}`, 1);
      }

      info(`Published ${opts.slug}@${opts.version}`);
    });
}
