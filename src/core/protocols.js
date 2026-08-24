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
  { id: '16:8', label: '16:8', hoursLabel: '16H', noteKey: 'protocol.16:8.note', targetMs: 16 * H },
  { id: '18:6', label: '18:6', hoursLabel: '18H', noteKey: 'protocol.18:6.note', targetMs: 18 * H },
  { id: '20:4', label: '20:4', hoursLabel: '20H', noteKey: 'protocol.20:4.note', targetMs: 20 * H },
  { id: 'omad', label: 'OMAD 23:1', hoursLabel: '23H', noteKey: 'protocol.omad.note', targetMs: 23 * H },
  {
    id: 'extended',
    // Se traduce: "EXTENDED" no dice nada en español.
    labelKey: 'protocol.extended.label',
    hoursLabel: '24H+',
    noteKey: 'protocol.extended.note',
    targetMs: 24 * H,
    stageTargetsMs: [24 * H, 36 * H, 48 * H, 72 * H],
  },
  { id: 'free', labelKey: 'protocol.free.label', hoursLabel: '—', noteKey: 'protocol.free.note', targetMs: null },
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
  { id: 'fed', hoursLabel: '00H', nameKey: 'stage.fed', noteKey: 'stage.fed.note', fromH: 0, toH: 4 },
  { id: 'glycogen', hoursLabel: '04H', nameKey: 'stage.glycogen', noteKey: 'stage.glycogen.note', fromH: 4, toH: 12 },
  { id: 'fatburn', hoursLabel: '12H', nameKey: 'stage.fatburn', noteKey: 'stage.fatburn.note', fromH: 12, toH: 16 },
  { id: 'ketosis', hoursLabel: '16H', nameKey: 'stage.ketosis', noteKey: 'stage.ketosis.note', fromH: 16, toH: 24 },
  { id: 'autophagy', hoursLabel: '24H', nameKey: 'stage.autophagy', noteKey: 'stage.autophagy.note', fromH: 24, toH: Infinity },
];

/** Etiqueta visible de un protocolo: fija (16:8) o traducida (LIBRE). */
export function protocolLabel(protocol, t) {
  return protocol.labelKey ? t(protocol.labelKey) : protocol.label;
}

/** @returns {'done'|'active'|'pending'} */
export function stageStatus(stage, elapsedMs, isFasting) {
  if (!isFasting) return 'pending';
  const hours = elapsedMs / H;
  if (hours >= stage.toH) return 'done';
  if (hours >= stage.fromH) return 'active';
  return 'pending';
}
