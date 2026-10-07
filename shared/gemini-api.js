/**
 * OmniAccess AI — AI Service (Gemini + Grok)
 * Supports Google Gemini and xAI Grok for text simplification and image descriptions.
 * Falls back to offline heuristics when no API key is configured.
 */

import { HeuristicSimplifier } from './heuristic-simplifier.js';

// ── Provider constants ──────────────────────────────────────────────────────
const PROVIDERS = {
  gemini: {
    name: 'Google Gemini',
    defaultModel: 'gemini-2.0-flash',
    models: ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'],
    endpoint: (model, apiKey) =>
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    buildBody: (parts, generationConfig) => ({ contents: [{ parts }], generationConfig }),
    parseResponse: (data) => data?.candidates?.[0]?.content?.parts?.[0]?.text,
    supportsVision: true,
  },
  grok: {
    name: 'Grok (xAI)',
    defaultModel: 'grok-3-mini-fast',
    models: ['grok-3-mini-fast', 'grok-3-mini', 'grok-3'],
    endpoint: () => 'https://api.x.ai/v1/chat/completions',
    buildBody: (messages, { temperature = 0.3, maxOutputTokens = 800 } = {}) => ({
      model: undefined, // set at call-site
      messages,
      temperature,
      max_tokens: maxOutputTokens,
      stream: false,
    }),
    parseResponse: (data) => data?.choices?.[0]?.message?.content,
    supportsVision: false, // grok-3 vision is limited; use text-only fallback
  },
};

export class GeminiService {
  constructor(apiKey = '', provider = 'gemini') {
    this.apiKey = apiKey;
    this.provider = provider in PROVIDERS ? provider : 'gemini';
    this.model = PROVIDERS[this.provider].defaultModel;
  }

  setApiKey(key) {
    this.apiKey = key;
  }

  setProvider(provider) {
    if (provider in PROVIDERS) {
      this.provider = provider;
      this.model = PROVIDERS[provider].defaultModel;
    }
  }

  setModel(model) {
    this.model = model || PROVIDERS[this.provider].defaultModel;
  }

  getProviderInfo() {
    return PROVIDERS[this.provider];
  }

  // ── Internal: call the active provider ─────────────────────────────────────

  async _callGemini(promptParts, generationConfig) {
    const info = PROVIDERS.gemini;
    const endpoint = info.endpoint(this.model, this.apiKey);
    const body = info.buildBody(promptParts, generationConfig);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => ({}));
      throw new Error(errJson.error?.message || `Gemini API error (${response.status})`);
    }

    const data = await response.json();
    const text = info.parseResponse(data);
    if (!text) throw new Error('No content returned by Gemini.');
    return text.trim();
  }

  async _callGrok(systemPrompt, userContent, generationConfig = {}) {
    const info = PROVIDERS.grok;
    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: userContent });

    const body = {
      model: this.model,
      messages,
      temperature: generationConfig.temperature ?? 0.3,
      max_tokens: generationConfig.maxOutputTokens ?? 800,
      stream: false,
    };

    const response = await fetch(info.endpoint(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => ({}));
      throw new Error(errJson.error?.message || `Grok API error (${response.status})`);
    }

    const data = await response.json();
    const text = info.parseResponse(data);
    if (!text) throw new Error('No content returned by Grok.');
    return text.trim();
  }

  // ── Check Chrome Built-in AI ───────────────────────────────────────────────

  async checkBuiltInAIAvailability() {
    try {
      if (typeof window !== 'undefined') {
        if (window.ai?.languageModel) {
          const cap = await window.ai.languageModel.capabilities();
          return cap.available === 'readily' || cap.available === 'after-download';
        }
        if (window.LanguageModel) return true;
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  // ── Image Description ──────────────────────────────────────────────────────

  /**
   * Describe an image, chart, UI layout, or meme.
   * @param {string} imageSource — Data URL (base64) or Image URL
   * @param {string} mode — 'auto' | 'chart' | 'ui' | 'meme' | 'general'
   * @param {string} contextHint — surrounding text or element title
   */
  async describeImage(imageSource, mode = 'auto', contextHint = '') {
    if (!this.apiKey) {
      return this.describeImageOffline(imageSource, contextHint);
    }

    let promptInstruction = '';
    if (mode === 'chart') {
      promptInstruction = 'You are an accessibility screen-reader assistant. Analyze this chart or infographic. State the chart type, title, axes labels, key data points, highest/lowest values, and the primary takeaway or trend. Be concise and structured.';
    } else if (mode === 'ui') {
      promptInstruction = 'You are an accessibility screen-reader assistant. Describe this user interface or layout. Detail the structural regions (navigation, main content, sidebar), primary interactive buttons, and visible state. Guide a blind user on how to interact with it.';
    } else if (mode === 'meme') {
      promptInstruction = 'You are an accessibility assistant. Explain this meme or cultural graphic for someone who cannot see it. Describe the visual imagery, transcribe any text or caption, and explain the joke, punchline, or cultural reference in clear, friendly language.';
    } else {
      promptInstruction = 'You are an accessibility assistant creating descriptive alt-text for a screen reader user. Provide a clear, vivid 2-3 sentence description of what is depicted in this image. Mention main subjects, colors, actions, and any visible text.';
    }

    if (contextHint) {
      promptInstruction += ` Surrounding context from the webpage: "${contextHint.slice(0, 300)}".`;
    }

    try {
      if (this.provider === 'grok') {
        // Grok does not reliably support vision in all tiers — use text-only with URL hint
        const userContent = imageSource.startsWith('data:image/')
          ? `[Image data provided. ${promptInstruction}]`
          : `Image URL: ${imageSource}. ${promptInstruction}`;

        const result = await this._callGrok('', userContent, { temperature: 0.3, maxOutputTokens: 350 });
        return { description: result, source: this.model, isOffline: false };
      }

      // Gemini: full vision support
      const parts = [{ text: promptInstruction }];
      if (imageSource.startsWith('data:image/')) {
        const mimeMatch = imageSource.match(/^data:(image\/[a-zA-Z+]+);base64,/);
        const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
        const base64Data = imageSource.replace(/^data:image\/[a-zA-Z+]+;base64,/, '');
        parts.push({ inlineData: { mimeType, data: base64Data } });
      } else {
        parts.push({ text: `Image URL: ${imageSource}. Provide a description based on context.` });
      }

      const result = await this._callGemini(parts, { temperature: 0.3, maxOutputTokens: 350 });
      return { description: result, source: this.model, isOffline: false };
    } catch (err) {
      console.warn('AI image description failed, falling back to offline:', err);
      return this.describeImageOffline(imageSource, contextHint, err.message);
    }
  }

  /**
   * Offline heuristic fallback for image description.
   */
  describeImageOffline(imageSource, contextHint = '', failureReason = '') {
    let cleanHint = (contextHint || '').trim();
    let desc = '';

    if (cleanHint) {
      desc = `Image with description: "${cleanHint}".`;
    } else {
      let filename = '';
      try {
        const url = new URL(imageSource, 'https://example.com');
        filename = url.pathname.split('/').pop().replace(/[-_]/g, ' ').replace(/\.[a-z0-9]+$/i, '');
      } catch (_) {}
      desc = filename?.length > 2 ? `Visual graphic representing ${filename}.` : 'Graphic image element on page.';
    }

    if (failureReason) {
      desc += ' (Note: AI API key required for full vision details.)';
    } else if (!this.apiKey) {
      desc += ' (Offline mode: configure an AI API key in extension settings for AI-powered descriptions.)';
    }

    return { description: desc, source: 'offline-heuristics', isOffline: true };
  }

  // ── Text Simplification ────────────────────────────────────────────────────

  /**
   * Simplify text using the active AI provider (or on-device Chrome AI / heuristics as fallback).
   * @param {string} text
   * @param {string} level — 'elementary' | 'plain' | 'summary'
   */
  async simplifyText(text, level = 'plain') {
    if (!text?.trim()) return '';

    const systemPrompt = `You are an expert cognitive accessibility assistant. Rewrite the user's text for a ${
      level === 'elementary' ? 'Grade 4 elementary reading level'
      : level === 'summary' ? 'concise 3-bullet summary'
      : 'plain English Grade 7 reading level'
    }. Preserve all key facts. Keep it short. Output ONLY the simplified text.`;

    const targetDesc = level === 'elementary'
      ? 'an elementary school reading level (Grade 4-5) using very simple words, short sentences, and friendly phrasing'
      : level === 'summary'
      ? 'a clear, 3-to-4 bullet point executive summary highlighting key actions and conclusions'
      : 'clear plain English (Grade 6-8) eliminating all complex jargon and long compound sentences';

    // 1. Try Chrome Built-in AI (offline, privacy-first)
    try {
      if (typeof window !== 'undefined' && window.ai?.languageModel) {
        const session = await window.ai.languageModel.create({ systemPrompt });
        const result = await session.prompt(text);
        if (result?.trim()) {
          return { simplified: result.trim(), source: 'chrome-builtin-ai', isOffline: true };
        }
      }
    } catch (_) {}

    // 2. Try configured AI provider
    if (this.apiKey) {
      try {
        let result = '';

        if (this.provider === 'grok') {
          result = await this._callGrok(
            systemPrompt,
            text.slice(0, 4000),
            { temperature: 0.2, maxOutputTokens: 800 }
          );
        } else {
          // Gemini
          result = await this._callGemini(
            [{ text: `You are an accessibility plain-language simplifier. Rewrite the following text to ${targetDesc}. Output ONLY the simplified text without introductory preamble:\n\n${text.slice(0, 4000)}` }],
            { temperature: 0.2, maxOutputTokens: 800 }
          );
        }

        if (result) {
          return { simplified: result, source: this.model, isOffline: false };
        }
      } catch (err) {
        console.warn('AI text simplification failed, using heuristic engine:', err);
      }
    }

    // 3. Offline heuristic fallback
    const heuristicResult = HeuristicSimplifier.simplify(text, level);
    return { simplified: heuristicResult, source: 'offline-heuristics', isOffline: true };
  }

  // ── API Key Validation ─────────────────────────────────────────────────────

  /**
   * Test whether the given API key works for the current provider.
   * @param {string} apiKey
   * @returns {Promise<{valid: boolean, error?: string}>}
   */
  async testApiKey(apiKey) {
    if (!apiKey || apiKey.length < 10) {
      return { valid: false, error: 'Key is too short.' };
    }

    try {
      if (this.provider === 'grok') {
        // Grok: test with a minimal chat completion
        const response = await fetch('https://api.x.ai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: this.model,
            messages: [{ role: 'user', content: 'Hi' }],
            max_tokens: 5,
            stream: false,
          }),
        });
        if (response.status === 200 || response.status === 429) return { valid: true };
        const errJson = await response.json().catch(() => ({}));
        return { valid: false, error: errJson.error?.message || `HTTP ${response.status}` };
      }

      // Gemini
      for (const model of PROVIDERS.gemini.models) {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: 'Hi' }] }], generationConfig: { maxOutputTokens: 5 } }),
          }
        );
        if (response.status === 200 || response.status === 429) return { valid: true };
      }
      return { valid: false, error: 'Could not authenticate. Please check your API key.' };
    } catch (err) {
      return { valid: false, error: err.message };
    }
  }
}

export const geminiService = new GeminiService();
