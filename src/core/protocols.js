/**
 * Fasting protocols and metabolic stages.
 *
 * Extracted from the design prototype, with the targets made real. The prototype
 * derived its target with `parseInt(p.hours, 10)` against display strings, which
 * has two failures: 'FREE-FORM' has hours '—', so parseInt returns NaN and the
 * fallback silently sets a 16-hour target on a protocol whose entire point is
 * having none; and 'EXTENDED' has '24H+', which parses to a flat 24 and drops
 * the 24–72h staging.
 *
 * Durations are declared here as numbers. Display strings are display only.
 */

const H = 3600_000;

/**
 * @typedef {Object} Protocol
 * @property {string} id
 * @property {string} label     as shown in the picker
 * @property {string} hoursLabel display string, never parsed
 * @property {string} note
 * @property {number|null} targetMs  null = open-ended
 * @property {number[]} [stageTargetsMs] for extended fasts: successive goals
 */

/** @type {Protocol[]} */
export const PROTOCOLS = [
  { id: '16:8', label: '16:8', hoursLabel: '16H', note: 'Daily window — the default', targetMs: 16 * H },
  { id: '18:6', label: '18:6', hoursLabel: '18H', note: 'Tighter window, same rhythm', targetMs: 18 * H },
  { id: '20:4', label: '20:4', hoursLabel: '20H', note: 'Warrior window', targetMs: 20 * H },
  { id: 'omad', label: 'OMAD 23:1', hoursLabel: '23H', note: 'One meal a day', targetMs: 23 * H },
  {
    id: 'extended',
    label: 'EXTENDED',
    hoursLabel: '24H+',
    note: '24 – 72h, staged targets',
    targetMs: 24 * H,
    stageTargetsMs: [24 * H, 36 * H, 48 * H, 72 * H],
  },
  { id: 'free', label: 'FREE-FORM', hoursLabel: '—', note: 'No target, stop when you stop', targetMs: null },
];

export function protocolById(id) {
  return PROTOCOLS.find((p) => p.id === id) ?? null;
}

/**
 * For an extended fast, the next staged goal past the current elapsed time.
 * Returns null once the final stage is passed, or for any other protocol.
 */
export function nextStageTargetMs(protocol, elapsedMs) {
  if (!protocol?.stageTargetsMs) return null;
  return protocol.stageTargetsMs.find((t) => t > elapsedMs) ?? null;
}

/**
 * Metabolic stages, as labelled in the prototype.
 *
 * These are descriptive labels on a timeline, not clinical claims — the
 * boundaries are approximate and vary considerably between people.
 */
export const STAGES = [
  { hoursLabel: '00H', name: 'FED', note: 'Digesting, insulin elevated', fromH: 0, toH: 4 },
  { hoursLabel: '04H', name: 'GLYCOGEN', note: 'Liver stores draining', fromH: 4, toH: 12 },
  { hoursLabel: '12H', name: 'FAT BURN', note: 'Lipolysis ramping, insulin low', fromH: 12, toH: 16 },
  { hoursLabel: '16H', name: 'KETOSIS', note: 'Ketones above 0.5 mmol/L', fromH: 16, toH: 24 },
  { hoursLabel: '24H', name: 'AUTOPHAGY', note: 'Cellular clean-up accelerates', fromH: 24, toH: Infinity },
];

/** @returns {'done'|'active'|'pending'} */
export function stageStatus(stage, elapsedMs, isFasting) {
  if (!isFasting) return 'pending';
  const hours = elapsedMs / H;
  if (hours >= stage.toH) return 'done';
  if (hours >= stage.fromH) return 'active';
  return 'pending';
}
