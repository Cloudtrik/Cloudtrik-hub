# cloudtrik-hub configuration

## Environment variables

| Variable                          | Purpose                                                                          |
| --------------------------------- | -------------------------------------------------------------------------------- |
| `CLOUDTRIK_HUB_SITE`              | Site origin used for `/.well-known/cloudtrik-hub.json` discovery and for `login` |
| `CLOUDTRIK_HUB_REGISTRY`          | Registry API origin; overrides discovery                                         |
| `CLOUDTRIK_HUB_WORKDIR`           | Working directory for skill installs                                             |
| `CLOUDTRIK_HUB_CONFIG_PATH`       | Path to the CLI config file                                                      |
| `CLOUDTRIK_HUB_DISABLE_TELEMETRY` | Disable telemetry sync                                                           |
| `CLOUDTRIK_HUB_SCANNER_BIN`       | Absolute path to an install-time scanner executable                              |

## Registry resolution

Precedence, highest first:

1. `--registry <url>`
2. `CLOUDTRIK_HUB_REGISTRY`
3. `/.well-known/cloudtrik-hub.json` on the site origin (`--site`, `CLOUDTRIK_HUB_SITE`, else the built-in default)
4. `registry` cached in the config file
5. The built-in default registry origin

Step 5 applies **only** when no site was named. If you point the CLI at a site with `--site` or
`CLOUDTRIK_HUB_SITE` and that site advertises no registry, the CLI **fails closed** and reports that the
registry is unreachable, rather than silently substituting a different origin.

## Install-time scanner gate

`install` and `update` scan a downloaded package **before** it is moved into place, and abort when the scan
reports `ok: false`.

The scanner is resolved in this order:

1. An adapter injected programmatically with `setScannerAdapter()`
2. The executable named by `CLOUDTRIK_HUB_SCANNER_BIN`
3. An executable named `cloudtrik-skill-scan` found on `PATH`
4. Otherwise: **fail closed** — the install is refused

A scanner executable receives the target path as `argv[1]` and is expected to print a `ScanReport` JSON
object on stdout:

```json
{ "findings": [], "criticalCount": 0, "ok": true, "toolErrors": [] }
```

There is deliberately no way to disable the gate. Before 0.1.1 an unconfigured install reported every
package as safe without reading it; an opt-out would restore exactly that behaviour.

Because resolution falls back to a `PATH` lookup, an environment only has to place the scanner on `PATH`
once for every execution context — login shell, `sudo -u`, cron and service units — to be covered. An
environment variable set inside a single service unit reaches only that unit's children.
