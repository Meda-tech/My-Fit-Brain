// @mfb/engine — one pure, config-driven assessment engine for every test.
// No database, network, clock or randomness: the same config and answers always give the same result.
// Server helpers that load from Supabase are in "@mfb/engine/server".

export { ENGINE_VERSION } from './version';
export * from './types';
export * from './errors';
export { evaluateCondition, isTrue, type TriState } from './conditions';
export { roundPercent, bandFor, type Facts } from './facts';
export { buildFacts, getFlow, nextQuestion, pruneAnswers, checkInterrupts } from './flow';
export { score } from './score';
export { compareProgress } from './progress';
export { runTestCase } from './test-cases';
export { resolveReportTexts, type ResolvedReport, type LocalText, type ReportLanguage } from './texts';
