/**
 * Registry HTTP route table — single source of truth for API paths.
 *
 * Static paths are exposed as readonly strings; templated paths are functions
 * that take URL-safe arguments and return the formatted path. All slug inputs
 * are URL-encoded.
 *
 * The route table mirrors the path layout documented in the cloudtrik-hub
 * CLI spec. Routes are pure paths (no host); the registry client composes
 * them against the resolved registry origin URL.
 */

export const ApiRoutes = {
  // Public read
  search: '/api/search',
  skillsList: '/api/v1/skills',
  skillDetail: (slug: string): string => `/api/v1/skills/${encodeURIComponent(slug)}`,
  skillVersions: (slug: string): string => `/api/v1/skills/${encodeURIComponent(slug)}/versions`,
  skillFile: (slug: string): string => `/api/v1/skills/${encodeURIComponent(slug)}/file`,
  download: '/api/v1/download',

  // CLI-authenticated
  cliWhoami: '/api/cli/whoami',
  cliPublish: '/api/cli/publish',
  cliUploadUrl: '/api/cli/upload-url',
  cliSkillDelete: '/api/cli/skill/delete',
  cliSkillUndelete: '/api/cli/skill/undelete',
  cliLogout: '/api/cli/logout',
  cliTelemetrySync: '/api/cli/telemetry/sync',

  // Discovery
  wellKnown: '/.well-known/cloudtrik-hub.json',
} as const;

export type ApiRouteKey = keyof typeof ApiRoutes;
