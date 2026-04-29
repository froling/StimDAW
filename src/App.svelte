<script lang="ts">
  import { createLogger } from './log';

  const log = createLogger('app');
  log.info('StimDAW α started');
</script>

<main>
  <header>
    <h1>StimDAW <span class="version">α</span></h1>
  </header>

  <section class="status">
    <p>
      Wedge α: live monitor + CLI passthrough. Implementation pending —
      bootstrap is up.
    </p>
    <p class="muted">
      See
      <a href="https://github.com/froling/StimDAW/blob/main/docs/designs/ALPHA_WEDGE.md"
        >ALPHA_WEDGE plan</a
      >
      for next steps.
    </p>
  </section>
</main>

<style>
  main {
    max-width: 720px;
    margin: 4rem auto;
    padding: 0 1.5rem;
    font-family:
      system-ui,
      -apple-system,
      sans-serif;
  }
  header h1 {
    margin: 0 0 1.5rem;
    font-size: 2.25rem;
  }
  .version {
    color: #888;
    font-weight: 400;
    font-size: 0.7em;
  }
  .status {
    color: #333;
    line-height: 1.5;
  }
  .muted {
    color: #777;
    font-size: 0.9rem;
  }
  a {
    color: #0066cc;
  }
</style>
