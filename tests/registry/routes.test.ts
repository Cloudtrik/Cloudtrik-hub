import { describe, it, expect } from 'vitest';
import { ApiRoutes } from '../../src/registry/routes.js';

describe('registry/routes', () => {
  it('exposes static paths', () => {
    expect(ApiRoutes.search).toBe('/api/search');
    expect(ApiRoutes.skillsList).toBe('/api/v1/skills');
    expect(ApiRoutes.cliWhoami).toBe('/api/cli/whoami');
    expect(ApiRoutes.cliPublish).toBe('/api/cli/publish');
    expect(ApiRoutes.cliUploadUrl).toBe('/api/cli/upload-url');
    expect(ApiRoutes.cliSkillDelete).toBe('/api/cli/skill/delete');
    expect(ApiRoutes.cliSkillUndelete).toBe('/api/cli/skill/undelete');
    expect(ApiRoutes.cliLogout).toBe('/api/cli/logout');
    expect(ApiRoutes.cliTelemetrySync).toBe('/api/cli/telemetry/sync');
    expect(ApiRoutes.wellKnown).toBe('/.well-known/cloudtrik-hub.json');
    expect(ApiRoutes.download).toBe('/api/v1/download');
  });

  it('URL-encodes templated slug paths', () => {
    expect(ApiRoutes.skillDetail('my-skill')).toBe('/api/v1/skills/my-skill');
    expect(ApiRoutes.skillFile('my-skill')).toBe('/api/v1/skills/my-skill/file');
    expect(ApiRoutes.skillVersions('my-skill')).toBe('/api/v1/skills/my-skill/versions');
    expect(ApiRoutes.skillDetail('weird slug')).toBe('/api/v1/skills/weird%20slug');
  });
});
