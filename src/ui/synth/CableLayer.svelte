<script lang="ts">
  import { synth, addCable, removeCable } from './synth-store.svelte';
  import { bezierPath, bezierMidpoint, lfoColorAndLabel } from './cable-helpers';
  import type { Cable } from '../../synth/types';

  /**
   * SVG cable-overlay. Renderar:
   *  - Existerande cables (bezier från LFO-port till knob-port, LFO-color)
   *  - Cable-mid-label "L1"/"L2"/etc. (color-blind a11y per audit F4)
   *  - Ghost-bezier under aktiv drag (dashed, mot cursor)
   *  - Drop-target-highlight på knobs under drag (per audit F5)
   *
   * Per eng-review 1.6A: SVG-rooten har pointer-events: none så underliggande
   * UI förblir klickbart. <path> har pointer-events: stroke för cable-click-
   * to-delete. Drag-creation startar från LFO-output-port DOM-element (inte
   * från SVG-layer).
   *
   * Cancel-gester per audit F5:
   *  - Esc-tangent under drag → cancel
   *  - Mouseup utanför knob-port → cancel
   *  - Drop på source LFO → no-op (cancel)
   */

  type Props = {
    /** Container-element vars getBoundingClientRect används som origin (0,0)
     *  i SVG-koordinatrymden. CableLayer beräknar port-positions relativt
     *  denna. Vanligtvis Mixer.svelte panel-elementet. */
    containerEl: HTMLElement | null;
  };

  let { containerEl }: Props = $props();

  type Pos = { x: number; y: number };

  /** Cache av port-positions, beräknad vid render via DOM-query. */
  let cableEndpoints = $state<Map<string, { source: Pos; dest: Pos }>>(new Map());

  /** Drag-state. null = idle. */
  let drag = $state<{
    sourceLfoId: string;
    sourcePos: Pos;
    cursorPos: Pos;
    color: string;
  } | null>(null);

  /**
   * Beräkna port-position relativt containerEl (SVG-rymdens origo).
   * Returnerar mittpunkten av port-elementets bounding rect.
   */
  function portPosition(portEl: Element, container: HTMLElement): Pos {
    const portRect = portEl.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    return {
      x: portRect.left + portRect.width / 2 - containerRect.left,
      y: portRect.top + portRect.height / 2 - containerRect.top,
    };
  }

  /** Beräkna alla cable-endpoints från DOM. Re-runs vid state-change/resize. */
  function computeEndpoints(): Map<string, { source: Pos; dest: Pos }> {
    const out = new Map<string, { source: Pos; dest: Pos }>();
    if (!containerEl) return out;
    for (const cable of synth.current.cables) {
      const sourceEl = containerEl.querySelector(
        `[data-port-type="output"][data-lfo-id="${cable.sourceLfoId}"]`,
      );
      const destEl = containerEl.querySelector(
        `[data-knob-port="true"][data-channel-id="${cable.destChannelId}"][data-knob-name="${cable.destKnobName}"]`,
      );
      if (!sourceEl || !destEl) continue;
      out.set(cable.id, {
        source: portPosition(sourceEl, containerEl),
        dest: portPosition(destEl, containerEl),
      });
    }
    return out;
  }

  // Re-compute endpoints när state eller containerEl ändras
  $effect(() => {
    cableEndpoints = computeEndpoints();
  });

  // Re-compute vid resize
  $effect(() => {
    if (!containerEl) return;
    const ro = new ResizeObserver(() => {
      cableEndpoints = computeEndpoints();
    });
    ro.observe(containerEl);
    return () => ro.disconnect();
  });

  // ── Drag-cable creation ────────────────────────────────────────

  function onContainerPointerDown(e: PointerEvent): void {
    const target = e.target as Element;
    const portEl = target.closest('[data-port-type="output"]');
    if (!portEl || !containerEl) return;
    const lfoId = portEl.getAttribute('data-lfo-id');
    if (!lfoId) return;

    e.preventDefault();
    const pos = portPosition(portEl, containerEl);
    const { color } = lfoColorAndLabel(synth.current.lfos, lfoId);
    drag = {
      sourceLfoId: lfoId,
      sourcePos: pos,
      cursorPos: pos,
      color,
    };

    // Capture pointer på document för att fånga move/up även utanför port
    const onMove = (ev: PointerEvent) => {
      if (!drag || !containerEl) return;
      const rect = containerEl.getBoundingClientRect();
      drag = {
        ...drag,
        cursorPos: { x: ev.clientX - rect.left, y: ev.clientY - rect.top },
      };
    };
    const onUp = (ev: PointerEvent) => {
      cleanup();
      if (!drag) return;
      // Hit-test against drop-targets
      const dropEl = document
        .elementFromPoint(ev.clientX, ev.clientY)
        ?.closest('[data-knob-port="true"]');
      if (dropEl) {
        const channelId = dropEl.getAttribute('data-channel-id');
        const knobName = dropEl.getAttribute('data-knob-name');
        if (
          channelId &&
          (knobName === 'pulseWidth' || knobName === 'pace' || knobName === 'amplitude')
        ) {
          addCable(drag.sourceLfoId, channelId, knobName, 0.5);
        }
      }
      drag = null;
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        cleanup();
        drag = null;
      }
    };
    function cleanup(): void {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
  }

  // ── Cable-click → delete ───────────────────────────────────────

  function onCableClick(cable: Cable, e: MouseEvent): void {
    e.stopPropagation();
    if (e.shiftKey) {
      // Shift+click → instant delete (per audit F5/E)
      removeCable(cable.id);
    } else if (confirm('Remove cable?')) {
      // Plain click → confirm
      removeCable(cable.id);
    }
  }

  /**
   * Keyboard equivalent för cable-click (per a11y audit-rec):
   * Enter = confirm-delete, Shift+Enter eller Delete = instant delete.
   */
  function onCableKeydown(cable: Cable, e: KeyboardEvent): void {
    if (e.key === 'Delete' || (e.key === 'Enter' && e.shiftKey)) {
      e.preventDefault();
      removeCable(cable.id);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (confirm('Remove cable?')) removeCable(cable.id);
    }
  }

  // ── Drop-target highlighting under drag ─────────────────────────

  $effect(() => {
    if (!containerEl) return;
    const ports = containerEl.querySelectorAll<HTMLElement>('[data-knob-port="true"]');
    if (drag === null) {
      // Cleanup all highlight classes
      for (const el of ports) {
        el.classList.remove('drop-target-available', 'drop-target-occupied');
        el.style.removeProperty('--drop-color');
      }
      return;
    }
    // Active drag: highlight drop-targets
    const dragColor = drag.color;
    for (const el of ports) {
      const channelId = el.getAttribute('data-channel-id');
      const knobName = el.getAttribute('data-knob-name');
      const channel = synth.current.channels.find((c) => c.id === channelId);
      if (!channel) continue;
      const knob = channel.knobs[knobName as 'pulseWidth' | 'pace' | 'amplitude'];
      const occupied = knob?.modCableId !== null && knob?.modCableId !== undefined;
      el.style.setProperty('--drop-color', dragColor);
      el.classList.add(occupied ? 'drop-target-occupied' : 'drop-target-available');
      el.classList.remove(occupied ? 'drop-target-available' : 'drop-target-occupied');
    }
  });
</script>

<svg
  class="cable-layer"
  xmlns="http://www.w3.org/2000/svg"
  onpointerdown={onContainerPointerDown}
  role="presentation"
>
  <!-- Existerande cables -->
  {#each synth.current.cables as cable (cable.id)}
    {@const endpoints = cableEndpoints.get(cable.id)}
    {#if endpoints}
      {@const colorLabel = lfoColorAndLabel(synth.current.lfos, cable.sourceLfoId)}
      {@const mid = bezierMidpoint(
        endpoints.source.x,
        endpoints.source.y,
        endpoints.dest.x,
        endpoints.dest.y,
        8,
      )}
      <path
        class="cable"
        d={bezierPath(
          endpoints.source.x,
          endpoints.source.y,
          endpoints.dest.x,
          endpoints.dest.y,
          8,
        )}
        stroke={colorLabel.color}
        onclick={(e) => onCableClick(cable, e)}
        onkeydown={(e) => onCableKeydown(cable, e)}
        aria-label={`Cable from ${colorLabel.label} to ${cable.destChannelId} ${cable.destKnobName}. Press Enter to delete, Shift+Enter or Delete för instant.`}
        role="button"
        tabindex="0"
      />
      <!-- Mid-label "L1"/"L2" för color-blind a11y -->
      <text
        class="cable-label"
        x={mid.x}
        y={mid.y}
        text-anchor="middle"
        dominant-baseline="middle"
        fill={colorLabel.color}
      >{colorLabel.label}</text>
    {/if}
  {/each}

  <!-- Ghost-cable under drag -->
  {#if drag !== null}
    <path
      class="cable cable-ghost"
      d={bezierPath(drag.sourcePos.x, drag.sourcePos.y, drag.cursorPos.x, drag.cursorPos.y, 8)}
      stroke={drag.color}
    />
  {/if}
</svg>

<style>
  .cable-layer {
    /* Per eng-review 1.6A: SVG fångar inte pointer-events, paths gör. */
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    overflow: visible;
  }

  .cable {
    fill: none;
    stroke-width: 2.4;
    stroke-linecap: round;
    /* Stroke-only pointer-events: cable-click går igenom transparent fyllnad */
    pointer-events: stroke;
    cursor: pointer;
    transition: stroke-width 0.1s, opacity 0.15s;
  }
  .cable:hover {
    stroke-width: 3.4;
  }
  .cable:focus-visible {
    outline: 2px solid currentColor;
    outline-offset: 2px;
  }

  .cable-ghost {
    stroke-dasharray: 6 4;
    stroke-width: 2;
    opacity: 0.6;
    pointer-events: none;
  }

  .cable-label {
    font-family: ui-monospace, monospace;
    font-size: 9px;
    font-weight: 600;
    pointer-events: none;
    user-select: none;
    paint-order: stroke fill;
    stroke: white;
    stroke-width: 3px;
    stroke-linejoin: round;
  }
</style>
