# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] - 2026-09-05

### Security
- **The install-time scanner gate now fails closed.** When no scanner can be resolved, `install` and
  `update` REFUSE the package instead of passing it. In 0.1.0 the default adapter was a no-op-PASS, so an
  install performed with no scanner configured reported every package as safe **without reading it** — a
  security control that silently disabled itself. There is deliberately no opt-out.
- Scanner resolution now falls back to a `cloudtrik-skill-scan` executable found on `PATH` before failing
  closed, so an environment can wire the scanner once for every execution context (login shell, `sudo -u`,
  cron, service units) rather than per-unit via an environment variable. Relative and empty `PATH` entries
  are ignored, so a `.` entry can never make the working directory a scanner source.

### Fixed
- **Default registry/site origin.** `DEFAULT_SITE`, `DEFAULT_REGISTRY` and the `login` browser flow all
  defaulted to an origin that serves no registry routes, leaving the CLI broken out of the box in any
  context without an environment override. All three now resolve to the registry origin, and `login` reads
  `DEFAULT_SITE` instead of carrying its own duplicated literal.
- Registry resolution fails closed: a site named by `--site`/`CLOUDTRIK_HUB_SITE` that advertises no
  registry now raises the "registry unavailable" error rather than silently falling back to a different
  origin. The built-in default still applies when no site was named.

### Changed
- Dependency lockfile refreshed within the existing semver ranges so the tested tree carries **zero** known
  advisories, production and development (`undici` moved to the patched `>=7.29.0` line; the test toolchain
  moved to `vitest` 3.x). No runtime dependency was added or removed.
- `docs/configuration.md` now documents registry precedence and the scanner gate in full.

## [0.1.0] - 2026-06-26

### Added
- Initial release.
- Subcommands: search, install, update, publish, list, login, logout, whoami, sync, delete, undelete, uninstall.
- Default registry discovery via /.well-known/cloudtrik-hub.json on configured site (default https://cloudtrik.com).
- Workdir resolution (cwd → CLOUDTRIK_HUB_WORKDIR → ~/.cloudtrik fallback).
- Stub scanner shim (CLOUDTRIK_HUB_SCANNER_BIN runtime injection point).
- Tests via vitest + undici MockAgent for registry mocking.

### Note
The Cloudtrik registry is rolling out. If `/.well-known/cloudtrik-hub.json` returns 404 on the configured site,
CLI commands that require the registry will print a typed status message with a link to the project repo.
