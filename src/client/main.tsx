import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { installFonts } from './fonts';
import './App.css';

// From this origin, never a font service: a map that says nothing leaves the
// machine used to ask Google for a stylesheet on every visit.
installFonts();

/**
 * A deploy replaces the hashed files an open page was built from, so a view it
 * has not opened yet asks for one that is gone. Vite reports that before the
 * view's own boundary sees it, and the one thing that helps is a reload onto
 * the build that exists now.
 *
 * Once per ten seconds, so a page that is still stale after the reload shows
 * the boundary and its Reload button instead of looping: an index.html cached
 * against the old filenames would otherwise reload forever.
 */
const RELOAD_KEY = 'ambit.chunkReloadAt';
window.addEventListener('vite:preloadError', event => {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? '0');
    if (Date.now() - last < 10_000) return;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // No storage to guard a loop with: the boundary says so and offers the
    // button, rather than reloading into the same failure.
    return;
  }
  event.preventDefault();
  window.location.reload();
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
