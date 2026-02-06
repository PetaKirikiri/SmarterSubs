/**
 * AI4Thai Configuration and Utilities
 * Shared utilities for all AI4Thai API calls
 */

export const STORAGE_KEY_AI4THAI_API_KEY = 'smartSubs_ai4thai_apiKey';
export const AI4THAI_G2P_ENDPOINT = 'https://api.aiforthai.in.th/g2p';
export const AI4THAI_TOKENIZE_ENDPOINT = 'https://api.aiforthai.in.th/longan/tokenize';

/**
 * Get AI4Thai API key from multiple sources (in priority order):
 * 1. localStorage (smartSubs_ai4thai_apiKey)
 * 2. window.__AI4THAI_API_KEY__
 * 3. process.env.VITE_AI4THAI_API_KEY
 * 4. import.meta.env.VITE_AI4THAI_API_KEY
 * @returns {string | null} API key or null if not found
 */
export function getAI4ThaiApiKey(): string | null {
  
  // Check localStorage first
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem(STORAGE_KEY_AI4THAI_API_KEY);
    if (stored && stored.trim()) {
      return stored.trim();
    }

    // Check window global
    const windowKey = (window as any).__AI4THAI_API_KEY__;
    if (windowKey) {
      const envKey = windowKey;
      if (envKey && typeof envKey === 'string' && envKey.trim()) {
        return envKey.trim();
      }
    }
  }

  // Check environment variables
  if (typeof process !== 'undefined' && process.env?.VITE_AI4THAI_API_KEY) {
    const envKey = process.env.VITE_AI4THAI_API_KEY;
    if (envKey && typeof envKey === 'string' && envKey.trim()) {
      return envKey.trim();
    }
  }

  // Check import.meta.env (Vite)
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_AI4THAI_API_KEY) {
    const envKey = import.meta.env.VITE_AI4THAI_API_KEY;
    if (envKey && typeof envKey === 'string' && envKey.trim()) {
      return envKey.trim();
    }
  }

  return null;
}

/**
 * Set AI4Thai API key in localStorage
 * @param {string} apiKey - API key to store
 */
export function setAI4ThaiApiKey(apiKey: string): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY_AI4THAI_API_KEY, apiKey);
  }
}
