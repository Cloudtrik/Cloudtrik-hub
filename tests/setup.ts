/**
 * Vitest setup: shared MockAgent + per-test environment teardown.
 *
 * Tests obtain the global MockAgent via `getTestMockAgent()` and intercept
 * registry HTTP via the `MockAgent.get(origin)` pattern. No live network
 * calls happen by default in the CI suite.
 */

import { afterEach, beforeAll } from 'vitest';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from 'undici';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';

let mockAgent: MockAgent | null = null;
let originalDispatcher: Dispatcher | null = null;

beforeAll(() => {
  originalDispatcher = getGlobalDispatcher();
  mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
});

afterEach(() => {
  if (mockAgent) {
    // Soft-reset for next test: dispose existing interceptors but keep agent.
    mockAgent.removeAllListeners();
  }
});

/**
 * Test helper: obtain the shared MockAgent for installing interceptors.
 * Fresh interceptors should be installed in each test to avoid bleed.
 */
export function getTestMockAgent(): MockAgent {
  if (!mockAgent) {
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    setGlobalDispatcher(mockAgent);
  }
  return mockAgent;
}

/**
 * Restore the original undici dispatcher (used by smoke tests that legitimately
 * need a live network probe — currently none in CI).
 */
export function restoreLiveDispatcher(): void {
  if (originalDispatcher) {
    setGlobalDispatcher(originalDispatcher);
  }
}

/**
 * Create a unique temporary directory for a test and return its absolute path.
 * Callers should pair this with `cleanupTempDir(path)` in a finally block.
 */
export async function makeTempDir(prefix: string = 'cloudtrik-hub-test-'): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

export async function cleanupTempDir(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}
