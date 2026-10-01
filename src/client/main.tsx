import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
// IBM Plex from this origin, latin only, in the weights the page uses. It came
// from Google Fonts, so opening a map that says nothing leaves the machine
// asked Google for a stylesheet on every visit, local or hosted.
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-sans/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import './App.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
