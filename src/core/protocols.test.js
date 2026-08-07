import test from 'node:test';
import assert from 'node:assert/strict';
import { PROTOCOLS, protocolById, nextStageTargetMs, STAGES, stageStatus } from './protocols.js';

const H = 3600_000;

test('every protocol declares a real duration, or null on purpose', () => {
  for (const p of PROTOCOLS) {
    assert.ok(p.targetMs === null || p.targetMs > 0, `${p.id} has a usable target`);
  }
});

test('FREE-FORM is null, not a parsed fallback to 16 hours', () => {
  assert.equal(protocolById('free').targetMs, null);
});

test('EXTENDED keeps its 24-72h staging instead of flattening to 24', () => {
  const ext = protocolById('extended');
  assert.deepEqual(ext.stageTargetsMs, [24 * H, 36 * H, 48 * H, 72 * H]);
  assert.equal(nextStageTargetMs(ext, 30 * H), 36 * H);
  assert.equal(nextStageTargetMs(ext, 50 * H), 72 * H);
  assert.equal(nextStageTargetMs(ext, 80 * H), null); // past the last stage
});

test('non-extended protocols have no staged targets', () => {
  assert.equal(nextStageTargetMs(protocolById('16:8'), 2 * H), null);
});

test('display strings are never the source of a duration', () => {
  // The prototype's bug in one line: parsing the label loses information.
  assert.ok(Number.isNaN(parseInt(protocolById('free').hoursLabel, 10)));
  assert.equal(parseInt(protocolById('extended').hoursLabel, 10), 24); // drops the "+"
});

test('stages advance from pending to active to done', () => {
  const ketosis = STAGES.find((s) => s.name === 'KETOSIS');
  assert.equal(stageStatus(ketosis, 10 * H, true), 'pending');
  assert.equal(stageStatus(ketosis, 18 * H, true), 'active');
  assert.equal(stageStatus(ketosis, 30 * H, true), 'done');
});

test('no stage reads as active when no fast is running', () => {
  for (const s of STAGES) assert.equal(stageStatus(s, 20 * H, false), 'pending');
});

test('the final stage has no upper bound', () => {
  const last = STAGES[STAGES.length - 1];
  assert.equal(stageStatus(last, 500 * H, true), 'active');
});
