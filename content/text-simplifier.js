/**
 * OmniAccess AI - Text Simplification Overlay
 * Simplifies all paragraph text on the page using Gemini LLM or offline heuristics,
 * with adjustable reading levels and Bionic Reading mode.
 * Plain script; exposes window.OmniTextSimplifier.
 */

(function () {
  'use strict';

  if (window.OmniTextSimplifier) return;

  // ─── Inline plain-language dictionary (subset for offline use) ───────────────

  const PLAIN_DICT = {
    'accommodate': 'fit', 'accompany': 'go with', 'accomplish': 'do',
    'acquire': 'get', 'additional': 'extra', 'approximately': 'about',
    'ascertain': 'find out', 'assistance': 'help', 'at the present time': 'now',
    'cease': 'stop', 'commence': 'start', 'demonstrate': 'show',
    'due to the fact that': 'because', 'endeavor': 'try', 'facilitate': 'help',
    'for the purpose of': 'to', 'furthermore': 'also', 'implement': 'carry out',
    'in order to': 'to', 'in the event that': 'if', 'initiate': 'start',
    'maintain': 'keep', 'modify': 'change', 'necessitate': 'need',
    'notify': 'tell', 'numerous': 'many', 'obtain': 'get', 'participate': 'take part',
    'pertaining to': 'about', 'possess': 'have', 'prior to': 'before',
    'proceed': 'go ahead', 'require': 'need', 'retain': 'keep',
    'subsequent to': 'after', 'subsequently': 'later', 'terminate': 'end',
    'transmit': 'send', 'utilize': 'use', 'utilization': 'use',
    'with regard to': 'about'
  };

  function heuristicSimplify(text, level) {
    if (!text || !text.trim()) return text;

    // Step 1: vocabulary substitution
    let simplified = text;
    for (const [complex, simple] of Object.entries(PLAIN_DICT)) {
      const regex = new RegExp(`\\b${complex}\\b`, 'gi');
      simplified = simplified.replace(regex, (match) => {
        return match[0] === match[0].toUpperCase()
          ? simple.charAt(0).toUpperCase() + simple.slice(1)
          : simple;
      });
    }

    // Step 2: shorten long sentences
    if (level === 'elementary') {
      simplified = simplified.replace(/;/g, '.');
      simplified = simplified.replace(/\s{2,}/g, ' ');
    }

    if (level === 'summary') {
      const sentences = simplified.split(/[.!?]+\s+/).filter(s => s.trim().length > 15);
      const top = sentences.slice(0, 4).map(s => `• ${s.trim()}`).join('\n');
      return top || simplified;
    }

    return simplified.trim();
  }

  function toBionicReading(text) {
    if (!text) return '';
    return text.replace(/\b([a-zA-Z0-9]+)\b/g, (word) => {
      const len = word.length;
      if (len <= 1) return word;
      let fixLen = len === 2 || len === 3 ? 1 : len === 4 ? 2 : Math.ceil(len * 0.45);
      const fix = word.slice(0, fixLen);
      const rest = word.slice(fixLen);
      return `<strong class="omni-bionic-fix">${fix}</strong>${rest}`;
    });
  }

  async function callAISimplify(text, level, apiKey, provider) {
    if (!apiKey) return null;

    const targetDesc = level === 'elementary'
      ? 'Rewrite this in simple words and short sentences suitable for elementary school reading (Grade 4). Keep all main ideas intact.'
      : level === 'summary'
      ? 'Provide a high-quality, clear, well-structured summary. Extract the core takeaways into 3-5 concise bullet points with bold keywords, plus a 1-sentence bottom-line conclusion.'
      : 'Rewrite this into clear, accessible plain language (Grade 7 level). Break up dense paragraphs, remove jargon, and improve readability while preserving meaning.';

    const prompt = `${targetDesc}\n\nText to process:\n"""\n${text.slice(0, 4500)}\n"""\n\nOutput only the processed text with no conversational preamble:`;

    try {
      if (provider === 'grok') {
        const grokModels = ['grok-2-1212', 'grok-beta', 'grok-3-mini-fast', 'grok-3-mini', 'grok-2'];
        for (const model of grokModels) {
          try {
            const response = await fetch('https://api.x.ai/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey.trim()}`
              },
              body: JSON.stringify({
                model: model,
                messages: [
                  {
                    role: 'system',
                    content: 'You are an expert accessibility assistant specializing in clear, concise summarization and plain language rewriting. Return only the final text, formatting cleanly with bullet points or paragraphs.'
                  },
                  { role: 'user', content: prompt }
                ],
                max_tokens: 1000,
                temperature: 0.3,
                stream: false
              })
            });
            if (response.ok) {
              const data = await response.json();
              const result = data?.choices?.[0]?.message?.content?.trim();
              if (result) return result;
            }
          } catch (_) {}
        }
        return null;
      }

      // Gemini
      const model = 'gemini-2.0-flash';
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.2, maxOutputTokens: 800 }
          })
        }
      );
      if (response.ok) {
        const data = await response.json();
        return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  class TextSimplifierEngine {
    constructor() {
      this.apiKey = '';
      this.provider = 'gemini';
      this.model = 'gemini-2.0-flash';
      this.level = 'plain'; // 'elementary' | 'plain' | 'summary'
      this.bionicEnabled = false;
      this.originalTexts = new Map(); // el -> original innerHTML
      this.isSimplified = false;
    }

    updateSettings({ geminiApiKey, grokApiKey, aiProvider, geminiModel, simplifyLevel, bionicReading } = {}) {
      if (aiProvider !== undefined) this.provider = aiProvider;
      if (aiProvider === 'grok' && grokApiKey !== undefined) this.apiKey = grokApiKey;
      else if (geminiApiKey !== undefined) this.apiKey = geminiApiKey;
      if (geminiModel !== undefined) this.model = geminiModel;
      if (simplifyLevel !== undefined) this.level = simplifyLevel;
      if (bionicReading !== undefined) this.bionicEnabled = bionicReading;
    }

    /**
     * Simplify all paragraph/article text on the page
     */
    async simplifyPage({ onProgress, apiKey, provider, level } = {}) {
      if (apiKey) this.apiKey = apiKey;
      if (provider) this.provider = provider;
      if (level) this.level = level;

      if (this.isSimplified) {
        this.restorePage();
        return { restored: true, count: 0 };
      }

      const targets = Array.from(document.querySelectorAll(
        'p, li, td, article, section > div, [role="article"] > div, blockquote, dd'
      )).filter(el => {
        if (el.closest('#omni-floating-dock, #omni-voice-hud, #omni-live-captions-hud, #omni-audit-panel')) return false;
        const text = el.innerText || el.textContent || '';
        return text.trim().length > 30; // process elements with meaningful content
      });

      let modifiedCount = 0;
      let done = 0;
      for (const el of targets) {
        const originalText = (el.innerText || el.textContent || '').trim();
        this.originalTexts.set(el, el.innerHTML);

        try {
          let simplified = null;

          // Try AI first if API key is provided and paragraph is substantial
          if (this.apiKey && originalText.length > 50) {
            simplified = await callAISimplify(originalText, this.level, this.apiKey, this.provider);
          }

          if (!simplified) {
            simplified = heuristicSimplify(originalText, this.level);
          }

          if (simplified && simplified !== originalText) {
            let html = simplified;
            if (this.bionicEnabled) {
              html = toBionicReading(html);
            }

            // For summary mode, format as list
            if (this.level === 'summary' && html.includes('•')) {
              const items = html.split('\n').filter(l => l.trim().startsWith('•'));
              html = '<ul class="omni-summary-list">' +
                items.map(i => `<li>${i.replace(/^•\s*/, '')}</li>`).join('') +
                '</ul>';
            }

            el.innerHTML = html;
            el.setAttribute('data-omni-simplified', 'true');
            el.style.setProperty('border-left', '3px solid #3b82f6', 'important');
            el.style.setProperty('padding-left', '8px', 'important');
            modifiedCount++;
          }
        } catch (_) {}

        done++;
        if (onProgress) onProgress(done, targets.length);
      }

      this.isSimplified = true;
      return { restored: false, count: modifiedCount, total: targets.length };
    }

    /**
     * Restore original page text
     */
    restorePage() {
      for (const [el, originalHTML] of this.originalTexts.entries()) {
        try {
          el.innerHTML = originalHTML;
          el.removeAttribute('data-omni-simplified');
          el.style.removeProperty('border-left');
          el.style.removeProperty('padding-left');
        } catch (_) {}
      }
      this.originalTexts.clear();
      this.isSimplified = false;
    }

    /**
     * Toggle bionic reading on page text without full simplification
     */
    applyBionicReading(enable) {
      this.bionicEnabled = enable;
      const targets = Array.from(document.querySelectorAll('p, li, article, [role="article"]'))
        .filter(el => !el.closest('#omni-floating-dock, #omni-voice-hud'));

      if (enable) {
        for (const el of targets) {
          if (el.dataset.omniBionic) continue;
          const text = el.innerText || el.textContent || '';
          if (text.trim().length < 10) continue;
          el.dataset.omniOriginalHtml = el.innerHTML;
          el.innerHTML = toBionicReading(el.innerHTML.replace(/<[^>]+>/g, (tag) => {
            // preserve tags, only convert text nodes
            return tag;
          }));
          el.dataset.omniBionic = 'true';
        }
      } else {
        for (const el of targets) {
          if (el.dataset.omniOriginalHtml) {
            el.innerHTML = el.dataset.omniOriginalHtml;
            delete el.dataset.omniOriginalHtml;
            delete el.dataset.omniBionic;
          }
        }
      }
    }

    /**
     * Simplify a specific selected text or element
     */
    async simplifyElement(el) {
      const text = (el.innerText || el.textContent || '').trim();
      if (!text) return;

      const original = el.innerHTML;
      let simplified = null;

      if (this.apiKey) {
        simplified = await callAISimplify(text, this.level, this.apiKey, this.provider);
      }
      if (!simplified) {
        simplified = heuristicSimplify(text, this.level);
      }

      if (simplified) {
        this.originalTexts.set(el, original);
        el.textContent = simplified;
        el.setAttribute('data-omni-simplified', 'true');
      }

      return simplified;
    }

    /**
     * Get readability score for current page
     */
    analyzeReadability() {
      const mainEl = document.querySelector('main, article, [role="main"]') || document.body;
      const text = (mainEl.innerText || mainEl.textContent || '').trim();
      if (!text) return null;

      const sentences = text.split(/[.!?]+\s+/).filter(s => s.trim().length > 0);
      const words = text.split(/\s+/).filter(w => w.length > 0);

      const sentenceCount = Math.max(1, sentences.length);
      const wordCount = Math.max(1, words.length);

      let totalSyllables = 0;
      for (const w of words) {
        let word = w.toLowerCase().replace(/[^a-z]/g, '');
        if (!word) continue;
        if (word.length <= 3) { totalSyllables += 1; continue; }
        word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
        const matches = word.match(/[aeiouy]{1,2}/g);
        totalSyllables += matches ? Math.max(1, matches.length) : 1;
      }

      const wordsPerSentence = wordCount / sentenceCount;
      const syllablesPerWord = totalSyllables / wordCount;

      const readingEase = Math.round(Math.max(0, Math.min(100,
        206.835 - (1.015 * wordsPerSentence) - (84.6 * syllablesPerWord)
      )));

      const gradeLevel = Math.max(1, Math.round(
        ((0.39 * wordsPerSentence) + (11.8 * syllablesPerWord) - 15.59) * 10
      ) / 10);

      const label = readingEase >= 90 ? 'Very Easy (5th grade)'
        : readingEase >= 80 ? 'Easy (6th grade)'
        : readingEase >= 70 ? 'Fairly Easy (7th grade)'
        : readingEase >= 60 ? 'Plain English (8th-9th grade)'
        : readingEase >= 50 ? 'Fairly Difficult (High School)'
        : readingEase >= 30 ? 'Difficult (College)'
        : 'Very Difficult (Graduate+)';

      return { readingEase, gradeLevel, wordCount, sentenceCount, label };
    }
  }

  window.OmniTextSimplifier = new TextSimplifierEngine();
})();
