/**
 * GPT Configuration and Utilities
 * Shared utilities for all GPT API calls
 */

/**
 * Get OpenAI API key from various sources
 * @returns API key or empty string if not found
 */
export function getOpenAIApiKey(): string {
  console.log('[GPT Config] Checking for OpenAI API key...');
  
  // Check localStorage (browser)
  if (typeof window !== 'undefined' && window.localStorage) {
    const localStorageKey = localStorage.getItem('smartSubs_openaiApiKey');
    if (localStorageKey && localStorageKey.trim()) {
      console.log('[GPT Config] Found API key in localStorage');
      return localStorageKey.trim();
    }
  }

  // Check window object (for browser injection)
  if (typeof window !== 'undefined' && (window as any).__OPENAI_API_KEY__) {
    const windowKey = (window as any).__OPENAI_API_KEY__;
    if (windowKey && typeof windowKey === 'string' && windowKey.trim()) {
      console.log('[GPT Config] Found API key in window.__OPENAI_API_KEY__');
      return windowKey.trim();
    }
  }

  // Check environment variables (Node.js/Vite)
  // Priority: import.meta.env (Vite standard) > process.env (Node.js/fallback)
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_OPENAI_API_KEY) {
    const key = import.meta.env.VITE_OPENAI_API_KEY;
    console.log('[GPT Config] Found API key in import.meta.env.VITE_OPENAI_API_KEY', key ? `(length: ${key.length})` : '(empty)');
    return key;
  }

  // Fallback to process.env for Node.js compatibility (like SmartSubs)
  if (typeof process !== 'undefined' && process.env?.VITE_OPENAI_API_KEY) {
    console.log('[GPT Config] Found API key in process.env.VITE_OPENAI_API_KEY');
    return process.env.VITE_OPENAI_API_KEY;
  }

  // Also check non-prefixed OPENAI_API_KEY for compatibility
  if (typeof process !== 'undefined' && process.env?.OPENAI_API_KEY) {
    console.log('[GPT Config] Found API key in process.env.OPENAI_API_KEY');
    return process.env.OPENAI_API_KEY;
  }

  console.warn('[GPT Config] No API key found in any source');
  return '';
}

/**
 * Test GPT API connection
 * @returns Random inspiring quote from GPT
 */
export async function testGPTConnection(): Promise<string> {
  const apiKey = getOpenAIApiKey();

  if (!apiKey) {
    throw new Error('OpenAI API key not found. Set VITE_OPENAI_API_KEY in .env or localStorage.smartSubs_openaiApiKey');
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'user', content: 'Give me a random inspiring quote.' }
        ],
        temperature: 0.7,
        max_tokens: 150
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GPT API error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const quote = data.choices?.[0]?.message?.content?.trim() || '';

    return quote;
  } catch (error) {
    throw new Error(`GPT API error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Generic GPT API call utility (optional, for future use)
 */
export interface CallGPTAPIOptions {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  maxTokens?: number; // Deprecated, use maxCompletionTokens
  maxCompletionTokens?: number;
  responseFormat?: { type: 'json_object' | 'text' };
}

/**
 * Generic GPT API call utility
 * @param options - API call options
 * @returns API response object
 */
export async function callGPTAPI(options: CallGPTAPIOptions): Promise<any> {
  console.log('[GPT Config] callGPTAPI called', { model: options.model, messageCount: options.messages?.length });
  
  const apiKey = getOpenAIApiKey();

  if (!apiKey) {
    console.error('[GPT Config] API key not found');
    throw new Error('OpenAI API key not found. Set VITE_OPENAI_API_KEY in .env or localStorage.smartSubs_openaiApiKey');
  }

  console.log('[GPT Config] API key found', { keyLength: apiKey.length, keyPrefix: apiKey.substring(0, 7) + '...' });

  const {
    model,
    messages,
    temperature = 0.7,
    maxTokens,
    maxCompletionTokens,
    responseFormat
  } = options;

  if (!model || !messages) {
    console.error('[GPT Config] Missing required parameters', { model, hasMessages: !!messages });
    throw new Error('Model and messages are required');
  }

  try {
    const body: any = {
      model,
      messages,
      temperature
    };

    // Use maxCompletionTokens if provided, otherwise fall back to maxTokens
    if (maxCompletionTokens !== undefined) {
      body.max_completion_tokens = maxCompletionTokens;
    } else if (maxTokens !== undefined) {
      body.max_tokens = maxTokens;
    }

    if (responseFormat) {
      body.response_format = responseFormat;
    }

    console.log('[GPT Config] Making API request', { 
      model, 
      messageCount: messages.length, 
      temperature, 
      hasResponseFormat: !!responseFormat,
      maxCompletionTokens: body.max_completion_tokens || body.max_tokens 
    });

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    console.log('[GPT Config] API response status', { status: response.status, ok: response.ok });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[GPT Config] API error response', { status: response.status, errorText });
      throw new Error(`GPT API error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    console.log('[GPT Config] API success', { 
      hasChoices: !!data.choices, 
      choiceCount: data.choices?.length,
      hasContent: !!data.choices?.[0]?.message?.content,
      contentLength: data.choices?.[0]?.message?.content?.length 
    });
    return data;
  } catch (error) {
    console.error('[GPT Config] API call exception', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
