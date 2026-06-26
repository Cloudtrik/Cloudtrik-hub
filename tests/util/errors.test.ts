import { describe, it, expect } from 'vitest';
import { CliError, explainError } from '../../src/util/errors.js';

describe('util/errors', () => {
  it('CliError carries the exit code', () => {
    const err = new CliError('boom', 42);
    expect(err.message).toBe('boom');
    expect(err.exitCode).toBe(42);
  });

  it('explainError unwraps CliError', () => {
    const explained = explainError(new CliError('boom', 3, 'try this'));
    expect(explained.message).toBe('boom');
    expect(explained.exitCode).toBe(3);
    expect(explained.hint).toBe('try this');
  });

  it('explainError handles plain Error with exitCode 1', () => {
    const explained = explainError(new Error('plain'));
    expect(explained.message).toBe('plain');
    expect(explained.exitCode).toBe(1);
  });

  it('explainError handles non-Error throws', () => {
    const explained = explainError('a string');
    expect(explained.message).toBe('a string');
    expect(explained.exitCode).toBe(1);
  });
});
