import React from 'react';
import ReactDOM from 'react-dom/client';
import Root from './components/ae/Root';
import './index.css';
import { initStorage } from './services/storage';
import { DB_KEY_LIST } from './services/db';
import { SETTINGS_KEY_LIST } from './services/settings';
import { LITERATURE_KEY_LIST } from './services/literature/storage';
import { AE_PREFS_KEY_LIST } from './services/ae/prefs';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);

// Migrate the host's localStorage tables + settings into IndexedDB once, then
// hydrate the in-memory cache before first render so the synchronous db/settings
// API reads real data. initStorage never rejects; on IndexedDB failure the app
// falls back to localStorage. The literature keys are hydrated (not migrated)
// so the sync snapshot captures them; the AE screen prefs (language, theme) are
// hydrated so their synchronous read survives a reload, and stay out of the
// snapshot (see services/ae/prefs.ts).
const migrateKeys = [...DB_KEY_LIST, ...SETTINGS_KEY_LIST];
const hydrateKeys = [...migrateKeys, ...LITERATURE_KEY_LIST, ...AE_PREFS_KEY_LIST];

initStorage(hydrateKeys, migrateKeys).finally(() => {
  root.render(
    <React.StrictMode>
      <Root />
    </React.StrictMode>
  );
});