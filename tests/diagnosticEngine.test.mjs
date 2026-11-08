// node --test tests/diagnosticEngine.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { PACK } from '../src/data/excelKnowledgePack.js';
import { answer, diagnose, lookupSource } from '../src/utils/diagnosticEngine.js';
import { ISSUE_PLAYBOOKS } from '../src/data/issuePlaybooks.js';
import { PROCESS_EDGES } from '../src/data/processTopology.js';

test('pack matches the workbook shape', () => {
  assert.equal(Object.keys(PACK.assets).length, 30);
  assert.equal(PACK.cases.length, 50);
  assert.equal(PACK.docs.length, 8);
});

test('P-002 diagnosis has instructions, process checks and grounded citations', () => {
  const r = diagnose('ASSET-014');
  assert.equal(r.asset.tag, 'P-002');
  assert.equal(r.asset.issue_code, 'CAVITATION_RISK');
  assert.ok(r.findings.some((f) => f.supports === true));
  assert.ok(r.steps.length >= 4 && r.steps.every((s) => s.items.length));
  assert.ok(r.upstream.length && r.downstream.length);
  assert.ok(r.caveats.some((c) => c.includes('assumed')));
  for (const id of r.citations) assert.ok(lookupSource(id), `unresolvable citation ${id}`);
});

test('every asset can be diagnosed and every issue code has a playbook', () => {
  for (const a of Object.values(PACK.assets)) {
    assert.ok(ISSUE_PLAYBOOKS[a.issue_code], `no playbook for ${a.issue_code}`);
    const r = diagnose(a.asset_id);
    for (const id of r.citations) assert.ok(lookupSource(id), `${a.tag}: unresolvable citation ${id}`);
  }
});

test('topology only references real tags', () => {
  const tags = new Set(Object.values(PACK.assets).map((a) => a.tag));
  for (const e of PROCESS_EDGES) assert.ok(tags.has(e.from) && tags.has(e.to), `${e.from} -> ${e.to}`);
});

test('query routing', () => {
  assert.equal(answer('guide me to P-005').kind, 'guide');
  assert.equal(answer('guide me to P-005').assetId, 'ASSET-017');
  assert.equal(answer('inspect P-002').kind, 'guide');
  assert.equal(answer("what's around me?", { nearbyAssets: [] }).kind, 'nearby');
  assert.equal(answer('Which assets need attention first?').kind, 'triage');
  const up = answer('What upstream and downstream checks for CV-003?');
  assert.equal(up.kind, 'diagnosis');
  assert.equal(up.focus, 'process');
  assert.equal(answer('LOTO for M-006').focus, 'steps');
  assert.equal(answer('seal leakage').kind, 'search');
});
