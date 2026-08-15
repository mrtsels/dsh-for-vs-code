import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChangesApp } from './ChangesApp.js';

const rootEl = document.getElementById('root');
if (rootEl) createRoot(rootEl).render(<ChangesApp />);
