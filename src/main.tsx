import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import App from './App';
import './index.css';

// Global error handlers for debugging crashes

// Handle unhandled promise rejections
window.addEventListener('unhandledrejection', (event) => {
  console.error('[CRASH] Unhandled promise rejection:', event.reason);
});

// Handle general errors
window.addEventListener('error', (event) => {
  console.error('[CRASH] Global error:', event.error);
});

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  try {
    root.render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    );
  } catch (err) {
    console.error('[CRASH] React render error:', err);
    throw err;
  }
} else {
  console.error('[CRASH] Root container not found');
}
