<script lang="ts">
  /**
   * Vertical fader — DAW-mixer-style. Used för channel AMP + master.
   *
   * Linear scale 0..max, vertical drag (upp = öka), Shift fine-grain (10x),
   * double-click reset till `defaultValue`. ARIA slider role + tabindex för
   * keyboard-accessibility.
   *
   * Layout: thin track centered vertically, thick handle that snaps to
   * value position. Total ~30px wide × ~150px tall (configurable).
   */
  import { formatKnobValue, type KnobUnit } from './knob-helpers';

  type Props = {
    value: number;
    bounds: { min: number; max: number };
    defaultValue: number;
    unit: KnobUnit;
    label: string;
    /** Modulation indicator — färgad ring runt handle när cable kopplad. */
    modSourceId?: string | null;
    modColor?: string;
    onChange?: (newValue: number) => void;
    /** Pixel-höjd för fader-track. Default 150. */
    height?: number;
    /** Pixel-bredd för fader-track. Default 30. */
    width?: number;
    /** Disabled state — render dim:ad och no-pointer-events. */
    disabled?: boolean;
  };

  let {
    value,
    bounds,
    defaultValue,
    unit,
    label,
    modSourceId = null,
    modColor = '#888',
    onChange,
    height = 150,
    width = 30,
    disabled = false,
  }: Props = $props();

  let isDragging = $state(false);
  let dragStartY = 0;
  let dragStartValue = 0;
  let dragShiftHeld = $state(false);

  // Map value till pixel-position på track. value=min → bottom (y=height),
  // value=max → top (y=0). Linear.
  let normalizedT = $derived.by(() => {
    const range = bounds.max - bounds.min;
    if (range <= 0) return 0;
    return Math.max(0, Math.min(1, (value - bounds.min) / range));
  });

  /** Top-offset för handle: 0 vid max, height vid min */
  let handleTop = $derived((1 - normalizedT) * height);

  let formatted = $derived(formatKnobValue(value, unit));

  function onPointerDown(e: PointerEvent): void {
    if (disabled || e.button !== 0) return;
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
    // Sensitivity: 200px för full-range drag (Shift = 10x mindre, fine-grain)
    const sens = 200;
    const factor = dragShiftHeld ? 10 : 1;
    const tDelta = -deltaY / (sens * factor); // upp = positiv
    const range = bounds.max - bounds.min;
    const tCurrent = (dragStartValue - bounds.min) / range;
    const tNew = Math.max(0, Math.min(1, tCurrent + tDelta));
    onChange?.(bounds.min + tNew * range);
  }

  function onPointerUp(e: PointerEvent): void {
    if (!isDragging) return;
    isDragging = false;
    (e.currentTarget as Element).releasePointerCapture(e.pointerId);
  }

  function onDblClick(): void {
    if (disabled) return;
    onChange?.(defaultValue);
  }
</script>

<div
  class="fader-wrapper"
  class:disabled
  style="--w: {width}px; --h: {height}px;"
>
  <span class="fader-label">{label}</span>
  <div
    class="fader-track"
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
    aria-disabled={disabled}
    tabindex={disabled ? -1 : 0}
  >
    <!-- Center rail (visar full range, dimmed) -->
    <div class="rail"></div>
    <!-- Filled portion från botten till handle -->
    <div class="fill" style="height: {height - handleTop}px;"></div>
    <!-- Handle (greppbart) -->
    <div class="handle" style="top: {handleTop}px;"></div>
  </div>
  <span class="fader-readout">
    <span class="value">{formatted.display}</span>
    <span class="suffix">{formatted.suffix}</span>
  </span>
</div>

<style>
  .fader-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    user-select: none;
  }
  .fader-wrapper.disabled {
    opacity: 0.4;
    pointer-events: none;
  }
  .fader-label {
    font-size: 0.62rem;
    font-family: ui-monospace, monospace;
    color: #666;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .fader-track {
    position: relative;
    width: var(--w);
    height: var(--h);
    cursor: ns-resize;
    touch-action: none;
    border-radius: calc(var(--w) / 2);
    background: transparent;
  }
  .fader-track:focus-visible {
    outline: 2px solid #0066cc;
    outline-offset: 2px;
  }
  .rail {
    position: absolute;
    left: 50%;
    top: 4px;
    bottom: 4px;
    transform: translateX(-50%);
    width: 4px;
    background: #e5e5e5;
    border-radius: 2px;
  }
  .fill {
    position: absolute;
    left: 50%;
    bottom: 4px;
    transform: translateX(-50%);
    width: 4px;
    background: #0066cc;
    border-radius: 2px;
    transition: height 0.05s linear;
  }
  .fader-track.modulated .fill {
    background: var(--mod-color);
  }
  .handle {
    position: absolute;
    left: 50%;
    transform: translate(-50%, -50%);
    width: calc(var(--w) - 4px);
    height: 18px;
    background: linear-gradient(180deg, #fafafa 0%, #e5e5e5 50%, #d0d0d0 100%);
    border: 1px solid #999;
    border-radius: 3px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
    pointer-events: none;
  }
  .handle::before {
    /* Center groove för "professional fader" feel */
    content: '';
    position: absolute;
    left: 4px;
    right: 4px;
    top: 50%;
    transform: translateY(-50%);
    height: 2px;
    background: #555;
    border-radius: 1px;
  }
  .fader-track.dragging .handle {
    border-color: #0066cc;
    background: linear-gradient(180deg, #f0f7ff 0%, #d6e8ff 50%, #b8d8ff 100%);
  }
  .fader-track.fine-grain .handle {
    border-color: #cc6600;
  }
  .fader-track.modulated .handle {
    border-color: var(--mod-color);
    box-shadow: 0 0 0 2px var(--mod-color), 0 1px 2px rgba(0, 0, 0, 0.15);
  }

  .fader-readout {
    display: inline-flex;
    align-items: baseline;
    gap: 1px;
    font-family: ui-monospace, monospace;
    font-size: 0.68rem;
    color: #333;
  }
  .fader-readout .value {
    font-weight: 600;
  }
  .fader-readout .suffix {
    color: #888;
  }
</style>
