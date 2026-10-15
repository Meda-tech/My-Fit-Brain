// @mfb/questionbank — the question bank as versioned data.
// Excel parsing (exceljs) lives in the "@mfb/questionbank/parse" and "@mfb/questionbank/import"
// entry points so that importing types or the loader never pulls the parser into a bundle.

export * from './types';
export * from './conditions';
export * from './rules';
export * from './validate';
export * from './loader';
export * from './version-label';
export { attachRules, type AttachResult, type LatestVersionRules } from './attach-rules';
export { SEED_TESTS } from '../seeds/index';
