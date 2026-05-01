import { mount } from 'svelte';
import App from './App.svelte';
import { setLogLevel } from './log';
import './app.css';

if (import.meta.env.DEV) {
  setLogLevel('debug');
  // Test-helpers exponeras på window.__stimdaw_test för RPA-tooling.
  // Vite tree-shakar bort denna import + module helt i prod-build via
  // `import.meta.env.DEV` static-replacement.
  void import('./dev/test-helpers').then(({ installTestHelpers }) => {
    installTestHelpers();
  });
}

const target = document.getElementById('app');
if (!target) throw new Error('#app element not found in index.html');

export default mount(App, { target });
