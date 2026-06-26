## What
[brief description]

## Why
[motivation; link to issue]

## How verified
- [ ] `pnpm typecheck` clean
- [ ] `pnpm lint` 0 warnings
- [ ] `pnpm test` green
- [ ] `pnpm build` produces dist/
- [ ] `npm publish --dry-run` tarball whitelist matches package.json#files

## Sensitivity check
- [ ] No internal IP addresses
- [ ] No internal hostnames
- [ ] No secret tokens/keys
