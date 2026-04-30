/**
 * Single chokepoint amplitude clamp — outside-voice finding #3 från α2.
 *
 * effective = floor(descriptorAmp × rampPercent/100 × ceilingPercent/100)
 * capped at 255 (hardware byte max).
 *
 * Per α2 design-doc:
 * "Hardcoded MAX (255) kan ej överskridas oavsett bug i upstream-multiplier."
 *
 * Per eng-review 2.3A (β.0): Funktionen flyttad hit från
 * src/mock-firmware/waveform.ts. Synth-engine + waveform-gen importerar
 * härifrån — single chokepoint bevarat även när nya emit-paths tillkommer.
 *
 * Standalone funktion för att kunna unit-testa isolerat. ramp-controller
 * och max-ceiling kan ej överskrida denna gräns oavsett bugg.
 */

export function clampAmp(
  descriptorAmplitude: number,
  rampPercent: number,
  ceilingPercent: number,
): number {
  if (!Number.isFinite(descriptorAmplitude) || descriptorAmplitude <= 0) return 0;
  if (!Number.isFinite(rampPercent) || rampPercent <= 0) return 0;
  if (!Number.isFinite(ceilingPercent) || ceilingPercent <= 0) return 0;

  const rampClamped = Math.min(100, Math.max(0, rampPercent));
  const ceilingClamped = Math.min(100, Math.max(0, ceilingPercent));
  const ampClamped = Math.min(255, Math.max(0, descriptorAmplitude));

  const product = (ampClamped * rampClamped * ceilingClamped) / (100 * 100);
  return Math.min(255, Math.max(0, Math.floor(product)));
}
