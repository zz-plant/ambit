/**
 * The specimen page, served by Vite in a checkout at /ambit/dev/specimen.html
 * and never built into dist, since the build reads index.html alone. `?still`
 * draws each node as a saved file does, and `?scale=` sets the size; three
 * times a node is the default, a size a screenshot can judge a filter at.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import '../App.css';
import './specimen.css';
import { installFonts } from '../fonts';
import { SpecimenPage } from './SpecimenPage';

installFonts();

const params = new URLSearchParams(location.search);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SpecimenPage still={params.has('still')} scale={Number(params.get('scale')) || 3} />
  </React.StrictMode>
);
