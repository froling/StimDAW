<script lang="ts">
  /**
   * Per-channel elcon-editor. Två rader chips, en per buddy-pair-sida:
   *   T+ rad: A, C   (NeoDK switch matrix-paret som delar T+ wiring U4/U6)
   *   T− rad: B, D   (NeoDK switch matrix-paret som delar T− wiring U5/U7)
   *
   * Constraint by construction — UI kan inte producera invalid elcons:
   *   - Varje sida måste ha ≥1 aktiv chip (klick på sista aktiva = no-op)
   *   - {A,C} och {B,D} är fysiskt på OLIKA transformator-terminaler;
   *     den här uppdelningen följer hårdvaran direkt
   *
   * Polaritet (biphasic) hanteras automatiskt av synth-engine via phase-bit
   * flip per puls — användaren behöver inte välja "T+ eller T−" för någon
   * sida. Vi lagrar elcon kanoniskt: pos = {A,C}-subset, neg = {B,D}-subset.
   *
   * Per NeoDK-context-update 2026-05-02 + plan B från Option-list.
   */
  import { ElectrodeMask, type Elcon } from '../../patterns/types';

  type Props = {
    value: Elcon;
    onChange: (next: Elcon) => void;
  };
  let { value, onChange }: Props = $props();

  const PAIR_AC = ElectrodeMask.A | ElectrodeMask.C; // 0x05
  const PAIR_BD = ElectrodeMask.B | ElectrodeMask.D; // 0x0A

  // Kanonisk normalisering: pos är alltid {A,C}-subset, neg är alltid {B,D}-subset.
  // Synth-engine flippar phase-bit per puls för biphasic — så vilken slot pos/neg
  // hamnar i påverkar inte den fysiska upplevelsen.
  const acSide = $derived((value[0] & PAIR_AC) === value[0] && value[0] !== 0 ? value[0] : value[1]);
  const bdSide = $derived((value[0] & PAIR_AC) === value[0] && value[0] !== 0 ? value[1] : value[0]);

  function toggle(electrode: number, isAC: boolean): void {
    const current = isAC ? acSide : bdSide;
    const next = current ^ electrode;
    if (next === 0) return; // can't make side empty — at least 1 electrode required
    const newAC = isAC ? next : acSide;
    const newBD = isAC ? bdSide : next;
    // Lagra kanoniskt: pos = AC-side, neg = BD-side
    onChange([newAC, newBD]);
  }

  function isActive(electrode: number, isAC: boolean): boolean {
    const side = isAC ? acSide : bdSide;
    return (side & electrode) !== 0;
  }
</script>

<div class="elcon-picker" data-testid="elcon-picker">
  <div class="side-row" data-side="ac">
    <span class="side-label" title="T+ side — buddies on transformer T+ wiring (U4/U6)">T+</span>
    <button
      type="button"
      class="electrode-chip"
      class:active={isActive(ElectrodeMask.A, true)}
      onclick={() => toggle(ElectrodeMask.A, true)}
      data-electrode="A"
      aria-pressed={isActive(ElectrodeMask.A, true)}
    >A</button>
    <button
      type="button"
      class="electrode-chip"
      class:active={isActive(ElectrodeMask.C, true)}
      onclick={() => toggle(ElectrodeMask.C, true)}
      data-electrode="C"
      aria-pressed={isActive(ElectrodeMask.C, true)}
    >C</button>
  </div>
  <div class="side-row" data-side="bd">
    <span class="side-label" title="T− side — buddies on transformer T− wiring (U5/U7)">T−</span>
    <button
      type="button"
      class="electrode-chip"
      class:active={isActive(ElectrodeMask.B, false)}
      onclick={() => toggle(ElectrodeMask.B, false)}
      data-electrode="B"
      aria-pressed={isActive(ElectrodeMask.B, false)}
    >B</button>
    <button
      type="button"
      class="electrode-chip"
      class:active={isActive(ElectrodeMask.D, false)}
      onclick={() => toggle(ElectrodeMask.D, false)}
      data-electrode="D"
      aria-pressed={isActive(ElectrodeMask.D, false)}
    >D</button>
  </div>
</div>

<style>
  .elcon-picker {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    flex: 1;
  }
  .side-row {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }
  .side-label {
    font-family: ui-monospace, monospace;
    font-size: 0.65rem;
    font-weight: 600;
    color: #888;
    width: 1.5em;
    letter-spacing: 0.02em;
    user-select: none;
  }
  .electrode-chip {
    width: 22px;
    height: 22px;
    border-radius: 4px;
    border: 1px solid #ccc;
    background: white;
    color: #aaa;
    font-family: ui-monospace, monospace;
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    padding: 0;
    transition: background 0.1s, color 0.1s, border-color 0.1s;
  }
  .electrode-chip:hover {
    border-color: #888;
  }
  .electrode-chip.active {
    background: #d96a3d;
    color: white;
    border-color: #b8542d;
  }
  .electrode-chip.active:hover {
    background: #c45a30;
  }
</style>
