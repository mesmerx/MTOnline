import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './main.css';
import { useGameStore } from './store/useGameStore';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found');
}

if (import.meta.env.VITE_DEBUG_PEER === 'true') {
  (window as typeof window & { useGameStore?: typeof useGameStore }).useGameStore = useGameStore;
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
