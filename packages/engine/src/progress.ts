import type { VersionConfig } from '@mfb/questionbank';
import type { AssessmentResult, ProgressComparison } from './types';

// Progress re-test: per area, change = now % − first %, classified by qb_scoring.progress thresholds.

export function compareProgress(config: VersionConfig, first: AssessmentResult, progress: AssessmentResult): ProgressComparison {
  const p = config.scoring.progress;
  const areas = [first.coreModule, ...first.chosenModules].map((module) => {
    const before = first.modules[module]?.percent ?? null;
    const now = progress.modules[module]?.percent ?? null;
    if (before === null || now === null) {
      return { module, before, now, change: null, classification: null, textKey: null };
    }
    const change = now - before;
    const classification: 'better' | 'same' | 'worse' =
      change <= p.better_at ? 'better' : change >= p.worse_at ? 'worse' : 'same';
    return { module, before, now, change, classification, textKey: p.texts[classification] };
  });
  return { headingKey: p.texts.heading, lineKey: p.texts.line, areas };
}
