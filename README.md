# cloudtrik-hub

Search, install, update, and publish agent skills from the Cloudtrik registry.

## Install

```bash
npm i -g cloudtrik-hub
```

## Quick start

```bash
cloudtrik-hub login
cloudtrik-hub search "postgres backups"
cloudtrik-hub install my-skill
cloudtrik-hub list
cloudtrik-hub update --all
cloudtrik-hub publish ./my-skill --slug my-skill --name "My Skill" --version 1.0.0
```

See [docs/usage.md](./docs/usage.md) for full command reference and [docs/configuration.md](./docs/configuration.md) for environment configuration.

## Status

Pre-1.0. Registry endpoints are stabilizing. Run `cloudtrik-hub --version` for installed version.

## License

MIT — see [LICENSE](./LICENSE).
