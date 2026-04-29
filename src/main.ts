import { mount } from 'svelte';
import App from './App.svelte';
import { setLogLevel } from './log';
import './app.css';

if (import.meta.env.DEV) setLogLevel('debug');

const target = document.getElementById('app');
if (!target) throw new Error('#app element not found in index.html');

export default mount(App, { target });
