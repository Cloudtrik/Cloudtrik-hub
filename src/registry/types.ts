/**
 * Runtime-validated schemas for registry responses, using `arktype`.
 *
 * Each schema both validates the incoming JSON shape and produces a derived
 * TypeScript type so handlers can rely on the parsed result without separate
 * type guards.
 */

import { type } from 'arktype';

export const WellKnownSchema = type({
  apiBase: 'string',
  'authBase?': 'string',
  'registry?': 'string',
  'minCliVersion?': 'string',
});
export type WellKnown = typeof WellKnownSchema.infer;

export const SearchResultEntrySchema = type({
  slug: 'string',
  ownerHandle: 'string',
  displayName: 'string',
  summary: 'string',
  'score?': 'number',
  'version?': 'string|null',
  'updatedAt?': 'number',
});

export const SearchResultsSchema = type({
  results: SearchResultEntrySchema.array(),
});
export type SearchResults = typeof SearchResultsSchema.infer;
export type SearchResultEntry = typeof SearchResultEntrySchema.infer;

export const SkillVersionSchema = type({
  version: 'string',
  'changelog?': 'string',
  'tags?': 'string[]',
  'sha256?': 'string',
  'createdAt?': 'number',
});
export type SkillVersion = typeof SkillVersionSchema.infer;

export const SkillVersionsResponseSchema = type({
  versions: SkillVersionSchema.array(),
});
export type SkillVersionsResponse = typeof SkillVersionsResponseSchema.infer;

export const WhoamiResponseSchema = type({
  handle: 'string',
  'displayName?': 'string',
  'email?': 'string',
  'id?': 'string|number',
});
export type WhoamiResponse = typeof WhoamiResponseSchema.infer;

export const UploadUrlResponseSchema = type({
  uploadUrl: 'string',
  'uploadHeaders?': 'object',
  'uploadId?': 'string',
});
export type UploadUrlResponse = typeof UploadUrlResponseSchema.infer;

export const PublishResponseSchema = type({
  'ok?': 'boolean',
  'slug?': 'string',
  'version?': 'string',
  'url?': 'string',
});
export type PublishResponse = typeof PublishResponseSchema.infer;

export const DeleteResponseSchema = type({
  'ok?': 'boolean',
  'slug?': 'string',
});
export type DeleteResponse = typeof DeleteResponseSchema.infer;
