import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { installFonts } from './fonts';
import './App.css';

// From this origin, never a font service: a map that says nothing leaves the
// machine used to ask Google for a stylesheet on every visit.
installFonts();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
