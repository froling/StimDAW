<script lang="ts">
  import { app } from './stores.svelte';
  import type { Voltages } from '../protocol/attributes';

  type VKey = keyof Voltages;

  function sparkPoints(history: Voltages[], key: VKey, max: number): string {
    if (history.length < 2) return '';
    const w = 200;
    const h = 30;
    const step = w / Math.max(1, history.length - 1);
    return history
      .map((v, i) => {
        const y = h - Math.min(1, Math.max(0, (v[key] ?? 0) / max)) * h;
        return `${(i * step).toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }

  const vbatMax = 12000;
  const vcapMax = 80000;
  const iprimMax = 1000;

  let vbatPath = $derived(sparkPoints(app.voltageHistory, 'Vbat_mV', vbatMax));
  let vcapPath = $derived(sparkPoints(app.voltageHistory, 'Vcap_mV', vcapMax));
  let iprimPath = $derived(sparkPoints(app.voltageHistory, 'Iprim_mA', iprimMax));
</script>

<section class="monitor">
  <h2>Live monitor</h2>
  <div class="grid">
    <div class="metric">
      <div class="head">
        <span class="label">Vbat</span>
        <span class="value">{(app.voltages.Vbat_mV / 1000).toFixed(2)} V</span>
      </div>
      <svg viewBox="0 0 200 30" preserveAspectRatio="none" class="spark">
        <polyline points={vbatPath} />
      </svg>
    </div>
    <div class="metric">
      <div class="head">
        <span class="label">Vcap</span>
        <span class="value">{(app.voltages.Vcap_mV / 1000).toFixed(1)} V</span>
      </div>
      <svg viewBox="0 0 200 30" preserveAspectRatio="none" class="spark vcap">
        <polyline points={vcapPath} />
      </svg>
    </div>
    <div class="metric">
      <div class="head">
        <span class="label">Iprim</span>
        <span class="value">{app.voltages.Iprim_mA} mA</span>
      </div>
      <svg viewBox="0 0 200 30" preserveAspectRatio="none" class="spark iprim">
        <polyline points={iprimPath} />
      </svg>
    </div>
  </div>
  <p class="footnote">
    {app.voltageHistory.length} samples · pattern: <strong>{app.pattern || '—'}</strong> ·
    state: <strong>{app.playState}</strong>
  </p>
</section>

<style>
  .monitor {
    background: white;
    border: 1px solid #e5e5e5;
    border-radius: 8px;
    padding: 1rem 1.25rem;
  }
  h2 {
    margin: 0 0 0.75rem;
    font-size: 0.95rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #666;
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.75rem;
  }
  .metric {
    border: 1px solid #f0f0f0;
    border-radius: 6px;
    padding: 0.5rem 0.75rem;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 0.25rem;
  }
  .label {
    font-size: 0.85rem;
    color: #888;
  }
  .value {
    font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace;
    font-weight: 600;
    font-size: 1.1rem;
    color: #222;
  }
  .spark {
    width: 100%;
    height: 30px;
    display: block;
  }
  .spark polyline {
    fill: none;
    stroke: #0066cc;
    stroke-width: 1.2;
  }
  .vcap polyline {
    stroke: #cc6600;
  }
  .iprim polyline {
    stroke: #008866;
  }
  .footnote {
    margin: 0.6rem 0 0;
    color: #888;
    font-size: 0.8rem;
  }
</style>
