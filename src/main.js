import { jsx as _jsx } from "react/jsx-runtime";
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './app/index.css';
const container = document.getElementById('root');
if (!container) {
    throw new Error('No se encontró el elemento #root en index.html');
}
createRoot(container).render(_jsx(StrictMode, { children: _jsx(App, {}) }));
