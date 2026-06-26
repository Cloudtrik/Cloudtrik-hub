import { describe, it, expect } from 'vitest';
import { getCliVersion, getCliName } from '../../src/util/build-info.js';

describe('util/build-info', () => {
  it('returns the configured CLI name', () => {
    expect(getCliName()).toBe('cloudtrik-hub');
  });

  it('returns a non-empty semver-like string for getCliVersion', () => {
    const v = getCliVersion();
    expect(typeof v).toBe('string');
    expect(v.length).toBeGreaterThan(0);
  });

  it('caches the version on subsequent calls', () => {
    const first = getCliVersion();
    const second = getCliVersion();
    expect(first).toBe(second);
  });
});
