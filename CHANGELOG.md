# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
