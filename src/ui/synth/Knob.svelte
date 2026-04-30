<script lang="ts">
  import {
    valueToT,
    dragDeltaToValue,
    formatKnobValue,
    type KnobBounds,
    type KnobUnit,
  } from './knob-helpers';

  /**
   * Reusable knob med vertikal-drag, Shift fine-grain, double-click reset.
   * Per eng-review 1.4A semantik. Visar mod-ring (LFO-färg) när modulerad.
   *
   * Knob-position rör sig INTE under LFO-modulation (Reason-style):
   * `value` är knob.base. UI ovanpå kan visa halo för swing-range (β.1).
   */

  type Props = {
    value: number;
    bounds: KnobBounds;
    /** true för pace (4 dekader log-scale per 1.4A). */
    log?: boolean;
    /** Default-värde för double-click reset. */
    defaultValue: number;
    /** Visad enhet i readout. */
    unit: KnobUnit;
    /** Label ovanför knob (t.ex. "PW"). */
    label: string;
    /** Modulation-state — null = static, string = LFO-id som modulerar. */
    modSourceId?: string | null;
    /** CSS-färg från modulation-source (för mod-ring). */
    modColor?: string;
    /** Callback när användaren ändrar värde. Får nytt value. */
    onChange?: (newValue: number) => void;
    /** Storlek i pixels (diameter). Default 48. */
    size?: number;
  };

  let {
    value,
    bounds,
    log = false,
    defaultValue,
    unit,
    label,
    modSourceId = null,
    modColor = '#888',
    onChange,
    size = 48,
  }: Props = $props();

  let isDragging = $state(false);
  let dragStartY = 0;
  let dragStartValue = 0;
  let dragShiftHeld = $state(false);

  // Visuell rotation: -135° (min) till +135° (max), så pekaren fyller 270° båge
  let knobAngle = $derived(-135 + valueToT(value, bounds, { log }) * 270);
  let fillFraction = $derived((knobAngle - -135) / 270);
  let pointerX = $derived(Math.cos(((knobAngle - 90) * Math.PI) / 180) * 28);
  let pointerY = $derived(Math.sin(((knobAngle - 90) * Math.PI) / 180) * 28);
  let arcEndX = $derived(Math.cos(((knobAngle - 90) * Math.PI) / 180) * 45.96);
  let arcEndY = $derived(Math.sin(((knobAngle - 90) * Math.PI) / 180) * 45.96);

  let formatted = $derived(formatKnobValue(value, unit));

  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return; // bara left-click
    e.preventDefault();
    isDragging = true;
    dragStartY = e.clientY;
    dragStartValue = value;
    dragShiftHeld = e.shiftKey;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent): void {
    if (!isDragging) return;
    dragShiftHeld = e.shiftKey;
    const deltaY = e.clientY - dragStartY;
    const newValue = dragDeltaToValue(dragStartValue, deltaY, bounds, {
      log,
      fineGrain: dragShiftHeld,
    });
    onChange?.(newValue);
  }

  function onPointerUp(e: PointerEvent): void {
    if (!isDragging) return;
    isDragging = false;
    (e.currentTarget as Element).releasePointerCapture(e.pointerId);
  }

  function onDblClick(): void {
    onChange?.(defaultValue);
  }
</script>

<div class="knob-wrapper" style="--size: {size}px;">
  <span class="knob-label">{label}</span>
  <div
    class="knob"
    class:dragging={isDragging}
    class:fine-grain={dragShiftHeld}
    class:modulated={modSourceId !== null}
    style="--mod-color: {modColor};"
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    ondblclick={onDblClick}
    role="slider"
    aria-label={label}
    aria-valuenow={value}
    aria-valuemin={bounds.min}
    aria-valuemax={bounds.max}
    tabindex="0"
  >
    <!-- Mod-ring runt knob när modulerad -->
    <svg class="knob-bg" viewBox="-50 -50 100 100" preserveAspectRatio="xMidYMid meet">
      <!-- Outer arc 270° för rotations-range (visuell guide) -->
      <path
        class="knob-track"
        d="M -32.4 32.4 A 45.96 45.96 0 1 1 32.4 32.4"
        fill="none"
        stroke-width="3"
      />
      <!-- Filled arc upp till knob-angle, från min (-135°) till current -->
      <path
        class="knob-fill"
        d="M -32.4 32.4 A 45.96 45.96 0 {fillFraction > 0.5 ? '1' : '0'} 1 {arcEndX.toFixed(2)} {arcEndY.toFixed(2)}"
        fill="none"
        stroke-width="3"
      />
      <!-- Pointer-line från center till edge vid current angle -->
      <line
        class="knob-pointer"
        x1="0"
        y1="0"
        x2={pointerX.toFixed(2)}
        y2={pointerY.toFixed(2)}
        stroke-width="3"
        stroke-linecap="round"
      />
      <!-- Center dot -->
      <circle class="knob-center" cx="0" cy="0" r="4" />
    </svg>
  </div>
  <span class="knob-readout">
    <span class="value">{formatted.display}</span>
    <span class="suffix">{formatted.suffix}</span>
  </span>
</div>

<style>
  .knob-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    user-select: none;
  }
  .knob-label {
    font-size: 0.65rem;
    font-family: ui-monospace, monospace;
    color: #666;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .knob {
    width: var(--size);
    height: var(--size);
    cursor: ns-resize;
    border-radius: 50%;
    background: #fafafa;
    border: 1px solid #d0d0d0;
    position: relative;
    touch-action: none;
    transition: border-color 0.1s;
  }
  .knob:hover {
    border-color: #0066cc;
  }
  .knob:focus-visible {
    outline: 2px solid #0066cc;
    outline-offset: 2px;
  }
  .knob.dragging {
    border-color: #0066cc;
    background: #f0f7ff;
  }
  .knob.fine-grain {
    border-color: #cc6600; /* visuell hint att Shift är på */
  }
  .knob.modulated {
    border-color: var(--mod-color);
    box-shadow: 0 0 0 2px var(--mod-color);
  }

  .knob-bg {
    width: 100%;
    height: 100%;
    display: block;
  }
  .knob-track {
    stroke: #e5e5e5;
  }
  .knob-fill {
    stroke: #0066cc;
  }
  .knob.modulated .knob-fill {
    stroke: var(--mod-color);
  }
  .knob-pointer {
    stroke: #333;
  }
  .knob-center {
    fill: #555;
  }

  .knob-readout {
    display: inline-flex;
    align-items: baseline;
    gap: 1px;
    font-family: ui-monospace, monospace;
    font-size: 0.7rem;
    color: #333;
  }
  .knob-readout .value {
    font-weight: 600;
  }
  .knob-readout .suffix {
    color: #888;
  }
</style>
