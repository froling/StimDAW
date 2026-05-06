<script lang="ts">
  /**
   * Compact 1-row telemetri-status — bor i topbar.
   *
   * Ersätter den gamla 3-radiga sparkline-Monitor:n (per UX-review:
   * sparklines är debug-data sällan-tittade, tar prime real estate).
   * Värdena är tone-coded (grön=OK, gul=warning, röd=alarm) så safety-
   * status syns på en sekund utan att lämna play-vy:n.
   *
   * Tröskelvärden kalibrerade mot brief-§7 + Design.md:
   *   Vbat:  < 7000 mV  → låg batterivarning (gul)
   *   Vcap:  > 12 000 mV → spike-larm (röd; Brief §12)
   *   Iprim: > 1000 mA  → överströmning (röd; Brief §12)
   */
  import { app } from './stores.svelte';

  type Tone = 'ok' | 'warn' | 'alarm';

  function vbatTone(mV: number): Tone {
    if (mV < 6500) return 'alarm'; // helt urladdat
    if (mV < 7000) return 'warn'; // låg batteri
    return 'ok';
  }
  function vcapTone(mV: number): Tone {
    if (mV > 12000) return 'alarm'; // spike-larm per Brief §12
    if (mV > 10000) return 'warn'; // närmar sig hård gräns
    return 'ok';
  }
  function iprimTone(mA: number): Tone {
    if (mA > 1000) return 'alarm'; // överströmning
    if (mA > 800) return 'warn';
    return 'ok';
  }

  let vbatTrace = $derived(vbatTone(app.voltages.Vbat_mV));
  let vcapTrace = $derived(vcapTone(app.voltages.Vcap_mV));
  let iprimTrace = $derived(iprimTone(app.voltages.Iprim_mA));

  function connectionLabel(state: string): string {
    if (state === 'connected') return 'connected';
    if (state === 'connecting') return 'connecting…';
    if (state === 'ramping') return 'ramping';
    return 'disconnected';
  }
</script>

<div class="monitor-bar" aria-label="Live telemetry">
  <span class="conn" class:connected={app.connection === 'connected' || app.connection === 'ramping'}>
    <span class="conn-dot"></span>
    {connectionLabel(app.connection)}
  </span>
  <span class="sep">·</span>
  <span class="metric tone-{vbatTrace}" title="Battery voltage">
    <span class="metric-label">Vbat</span>
    <span class="metric-value">{(app.voltages.Vbat_mV / 1000).toFixed(2)}V</span>
  </span>
  <span class="sep">·</span>
  <span class="metric tone-{vcapTrace}" title="Primary capacitor voltage (alarm > 12V)">
    <span class="metric-label">Vcap</span>
    <span class="metric-value">{(app.voltages.Vcap_mV / 1000).toFixed(1)}V</span>
  </span>
  <span class="sep">·</span>
  <span class="metric tone-{iprimTrace}" title="Primary current (alarm > 1A)">
    <span class="metric-label">Iprim</span>
    <span class="metric-value">{app.voltages.Iprim_mA}mA</span>
  </span>
</div>

<style>
  .monitor-bar {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-family: ui-monospace, SFMono-Regular, monospace;
    font-size: 0.75rem;
    color: #555;
    line-height: 1;
  }
  .conn {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    color: #888;
  }
  .conn.connected {
    color: #2a7;
  }
  .conn-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #ccc;
  }
  .conn.connected .conn-dot {
    background: #2a7;
    box-shadow: 0 0 6px rgba(34, 170, 119, 0.5);
  }
  .sep {
    color: #ccc;
  }
  .metric {
    display: inline-flex;
    align-items: baseline;
    gap: 0.2rem;
  }
  .metric-label {
    color: #888;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .metric-value {
    font-weight: 600;
    color: #333;
    font-variant-numeric: tabular-nums;
  }
  .tone-warn .metric-value {
    color: #cc6600;
  }
  .tone-alarm .metric-value {
    color: #cc0033;
    animation: alarm-blink 1s ease-in-out infinite;
  }
  @keyframes alarm-blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
</style>
