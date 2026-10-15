import { readFileSync, readdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEED_TESTS, SEED_WORKBOOKS } from '../seeds/index';
import { configFromPayload } from './config';
import { prepareImport } from './import';
import { applyPatch, patchSchema, type VersionPatch } from './patch';
import type { ImportPayload, VersionConfig } from './types';

// Node-only: builds the question-bank versions from the workbooks, seed rules and patches in this
// repository, exactly as they are in the database (for tests and offline checks; never in an app bundle).

export interface OfflineVersion {
  payload: ImportPayload;
  config: VersionConfig;
}

export interface OfflineBank {
  /** Every version known offline, by label (e.g. "1.1", "1.2"). */
  versions: Record<string, OfflineVersion>;
  /** The newest version (what is live after all patches are applied). */
  latest: OfflineVersion;
}

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const patchesDir = resolve(fileURLToPath(new URL('.', import.meta.url)), '../patches');

export async function loadOfflineBanks(): Promise<Record<string, OfflineBank>> {
  const seeds: Record<string, ImportPayload> = {};
  for (const [key, rel] of Object.entries(SEED_WORKBOOKS)) {
    const path = resolve(repoRoot, rel);
    const prepared = await prepareImport(readFileSync(path), { fileName: basename(path), tests: SEED_TESTS });
    if (!prepared.payload) throw new Error(`Could not build ${key}: ${prepared.errors.join('; ')}`);
    seeds[key] = prepared.payload;
  }
  // copy_from texts read the other test's seed version (see scripts/patch.ts).
  const ctx = {
    resolveText: (test: string, key: string) =>
      Object.values(seeds).find((p) => p.test_code === test)?.texts.find((t) => t.key === key) ?? null,
  };
  const patches: VersionPatch[] = readdirSync(patchesDir)
    .filter((f) => f.endsWith('.patch.json'))
    .map((f) => patchSchema.parse(JSON.parse(readFileSync(resolve(patchesDir, f), 'utf8'))));

  const banks: Record<string, OfflineBank> = {};
  for (const payload of Object.values(seeds)) {
    const versions: Record<string, OfflineVersion> = {
      [payload.version_label]: { payload, config: configFromPayload(payload, { status: 'retired' }) },
    };
    let current = payload;
    for (;;) {
      const next = patches.find((p) => p.test_code === current.test_code && p.base_version_label === current.version_label);
      if (!next) break;
      current = applyPatch(current, next, ctx);
      versions[current.version_label] = { payload: current, config: configFromPayload(current, { status: 'retired' }) };
    }
    const latest = versions[current.version_label];
    latest.config = configFromPayload(current, { status: 'live' });
    banks[payload.test_code] = { versions, latest };
  }
  return banks;
}
