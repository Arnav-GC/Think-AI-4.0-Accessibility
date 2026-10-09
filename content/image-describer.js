/**
 * OmniAccess AI - Image Description Engine
 * Finds all images on the page, fetches AI-powered descriptions via the Gemini API
 * (or falls back to offline heuristics), and injects them as accessible alt text
 * and aria-label attributes. Also supports click-to-describe any single image.
 * Plain script; exposes window.OmniImageDescriber singleton.
 */

(function () {
  'use strict';

  if (window.OmniImageDescriber) return;

  // ─── Gemini API caller (self-contained, no imports) ─────────────────────────

  async function callAIVision(imageDataUrl, prompt, apiKey, provider) {
    if (!apiKey) return null;

    try {
      if (provider === 'groq') {
        // Groq vision. GPT-OSS models are text-only, so images go to Groq's multimodal model.
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey.trim()}`
          },
          body: JSON.stringify({
            model: 'qwen/qwen3.8-27b',
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: prompt },
                  { type: 'image_url', image_url: { url: imageDataUrl } }
                ]
              }
            ],
            max_completion_tokens: 400,
            temperature: 0.3,
            stream: false
          })
        });
        if (response.ok) {
          const data = await response.json();
          return data?.choices?.[0]?.message?.content?.trim() || null;
        }
        return null;
      }

      if (provider === 'grok') {
        // Grok 2 Vision multimodal input
        const grokVisionModels = ['grok-2-vision-1212', 'grok-vision-beta', 'grok-2-vision'];
        for (const model of grokVisionModels) {
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
                    role: 'user',
                    content: [
                      { type: 'text', text: prompt },
                      {
                        type: 'image_url',
                        image_url: {
                          url: imageDataUrl,
                          detail: 'high'
                        }
                      }
                    ]
                  }
                ],
                max_tokens: 300,
                temperature: 0.3,
                stream: false
              })
            });
            if (response.ok) {
              const data = await response.json();
              const text = data?.choices?.[0]?.message?.content?.trim();
              if (text) return text;
            }
          } catch (_) {}
        }
        return null;
      }

      // Gemini vision
      const mimeMatch = imageDataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,/);
      const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
      const base64Data = imageDataUrl.replace(/^data:image\/[a-zA-Z+]+;base64,/, '');

      const model = 'gemini-2.0-flash';
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType, data: base64Data } }] }],
            generationConfig: { temperature: 0.3, maxOutputTokens: 300 }
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

  // ─── Canvas helper to convert <img> to base64 data URL ─────────────────────

  async function imgToDataUrl(imgEl) {
    // 1. Try canvas (works for same-origin and CORS-enabled images)
    try {
      const canvas = document.createElement('canvas');
      canvas.width = imgEl.naturalWidth || imgEl.width || 100;
      canvas.height = imgEl.naturalHeight || imgEl.height || 100;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(imgEl, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      if (dataUrl && dataUrl.length > 100) return dataUrl;
    } catch (_) {
      // Cross-origin SecurityError — fall through to background fetch
    }

    // 2. Fallback: fetch via background service worker (no CORS restrictions)
    const imgSrc = imgEl.src || imgEl.currentSrc;
    if (!imgSrc || imgSrc.startsWith('data:')) return null;
    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { type: 'FETCH_IMAGE_AS_DATA_URL', url: imgSrc },
          (resp) => resolve(resp)
        );
      });
      if (response && response.success && response.dataUrl) {
        return response.dataUrl;
      }
    } catch (_) {}

    return null;
  }

  // ─── Offline heuristic description ──────────────────────────────────────────

  /** Returns true if a string looks like a hash / random ID (not a human-readable name). */
  function looksLikeHash(str) {
    if (!str) return true;
    const s = str.replace(/\s+/g, '');
    // Pure hex string (MD5, SHA, etc.)
    if (/^[0-9a-f]{8,}$/i.test(s)) return true;
    // UUID-like
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return true;
    // Mostly digits/hashes — less than 30% real letters means not a word
    const letters = (s.match(/[a-zA-Z]/g) || []).length;
    if (s.length >= 8 && letters / s.length < 0.35) return true;
    // Looks like a content-hash filename (e.g. "abc123def456gh78")
    if (s.length >= 12 && /^[a-z0-9]+$/i.test(s) && !/[aeiou]{2}/i.test(s)) return true;
    return false;
  }

  function heuristicDescription(imgEl) {
    // Try existing alt / title / aria-label first
    const alt = imgEl.getAttribute('alt');
    if (alt && alt.trim() && !looksLikeHash(alt.trim())) return `Image: ${alt.trim()}`;

    const title = imgEl.getAttribute('title');
    if (title && title.trim() && !looksLikeHash(title.trim())) return `Graphic: ${title.trim()}`;

    const ariaLabel = imgEl.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim() && !looksLikeHash(ariaLabel.trim())) return ariaLabel.trim();

    // Surrounding figcaption is usually the best context
    const figcaption = imgEl.closest('figure')?.querySelector('figcaption');
    if (figcaption && figcaption.textContent.trim()) {
      return `Image: ${figcaption.textContent.trim()}`;
    }

    // Derive from src filename — ONLY if it looks like a real word, not a hash
    try {
      const url = new URL(imgEl.src, location.href);
      let filename = url.pathname.split('/').pop()
        .replace(/\.[a-z0-9]+$/i, '')  // strip extension
        .replace(/[-_]/g, ' ')          // dashes/underscores to spaces
        .trim();
      if (filename && filename.length > 2 && filename.length < 60 && !looksLikeHash(filename)) {
        // Capitalise first letter for readability
        filename = filename.charAt(0).toUpperCase() + filename.slice(1);
        return `Graphic: ${filename}`;
      }
    } catch (_) {}

    // No useful description found
    return null;
  }

  // ─── Detect image type from context ─────────────────────────────────────────

  function detectImageMode(imgEl) {
    const src = (imgEl.src || '').toLowerCase();
    const alt = (imgEl.alt || '').toLowerCase();
    const cls = (imgEl.className || '').toLowerCase();
    const nearest = imgEl.closest('figure, [data-type]');
    const dataType = nearest?.getAttribute('data-type') || '';

    if (/chart|graph|plot|infograph|bar|pie|line|scatter/.test(src + alt + cls + dataType)) return 'chart';
    if (/ui|screenshot|interface|layout|wireframe/.test(src + alt + cls)) return 'ui';
    if (/meme|funny|humor/.test(src + alt + cls)) return 'meme';
    return 'general';
  }

  // ─── Main class ─────────────────────────────────────────────────────────────

  class ImageDescriberEngine {
    constructor() {
      this.apiKey = '';
      this.provider = 'groq';
      this.model = 'qwen/qwen3.8-27b';
      this.described = new WeakSet(); // track already-processed images
      this.processing = false;
    }

    updateSettings({ geminiApiKey, grokApiKey, groqApiKey, aiProvider, geminiModel } = {}) {
      if (aiProvider !== undefined) this.provider = aiProvider;
      const keys = { groq: groqApiKey, grok: grokApiKey, gemini: geminiApiKey };
      if (keys[this.provider] !== undefined) this.apiKey = keys[this.provider];
      if (geminiModel !== undefined) this.model = geminiModel;
    }

    /**
     * Describe all images on the page that lack alt text
     */
    async describeAllImages({ onProgress, apiKey, provider } = {}) {
      if (apiKey) this.apiKey = apiKey;
      if (provider) this.provider = provider;

      if (this.processing) return { count: 0, total: 0 };
      this.processing = true;

      const images = Array.from(document.querySelectorAll('img')).filter(img => {
        if (this.described.has(img)) return false;

        // Skip role=presentation/none (decorative)
        const role = img.getAttribute('role');
        if (role === 'presentation' || role === 'none') return false;

        // Skip data URIs — they're usually tiny inline icons or placeholders
        if ((img.src || '').startsWith('data:') && (img.naturalWidth || 0) < 60) return false;

        // Skip invisible images
        const style = window.getComputedStyle(img);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;

        // Skip tiny images — icons, 1x1 tracking pixels (min 24x24)
        const w = img.naturalWidth  || img.offsetWidth  || parseInt(img.getAttribute('width')  || '0');
        const h = img.naturalHeight || img.offsetHeight || parseInt(img.getAttribute('height') || '0');
        if (w > 0 && w < 24) return false;
        if (h > 0 && h < 24) return false;

        // Process images with missing or empty alt, or images whose alt is just filename / unhelpful
        // Alt text auto-generated from the filename is only a placeholder: describe it properly.
        if (img.hasAttribute('data-omni-auto-alt')) return true;

        const alt = img.getAttribute('alt');
        return alt === null || alt.trim() === '' || looksLikeHash(alt.trim());
      });

      let describedCount = 0;
      let done = 0;
      for (const img of images) {
        try {
          const desc = await this.describeSingleImage(img);
          // Only inject badge if we got a real description
          if (desc && desc.length > 3) {
            img.setAttribute('alt', desc);
            img.setAttribute('aria-label', desc);
            img.removeAttribute('data-omni-auto-alt');
            this.described.add(img);
            this.injectDescriptionBadge(img, desc);
            describedCount++;
          }
        } catch (_) {}
        done++;
        if (onProgress) onProgress(done, images.length);
      }

      this.processing = false;
      return { count: describedCount, total: images.length };
    }

    /**
     * Describe a single image element
     * Returns the description string
     */
    async describeSingleImage(imgEl) {
      const mode = detectImageMode(imgEl);
      const contextHint = this.getContextHint(imgEl);

      let promptInstruction = '';
      if (mode === 'chart') {
        promptInstruction = 'Accessibility screen reader: analyze this chart. State: chart type, title, axes, key data points, trend/takeaway. Be concise.';
      } else if (mode === 'ui') {
        promptInstruction = 'Accessibility assistant: describe this UI layout. Detail regions (nav, main, sidebar), interactive elements, visible state. Guide blind user.';
      } else if (mode === 'meme') {
        promptInstruction = 'Accessibility assistant: explain this meme. Describe imagery, transcribe text, explain joke/cultural reference in clear language.';
      } else {
        promptInstruction = 'Accessibility alt-text: 1-2 sentences describing main subjects, colors, actions, visible text in this image.';
      }

      if (contextHint) {
        promptInstruction += ` Page context: "${contextHint.slice(0, 200)}"`;
      }

      // Try AI description
      if (this.apiKey) {
        const dataUrl = await imgToDataUrl(imgEl);
        if (dataUrl) {
          try {
            const aiDesc = await callAIVision(dataUrl, promptInstruction, this.apiKey, this.provider);
            if (aiDesc) return aiDesc;
          } catch (_) {}
        }
      }

      // Offline fallback
      return heuristicDescription(imgEl);
    }

    /**
     * Extract surrounding context text for an image
     */
    getContextHint(imgEl) {
      const figure = imgEl.closest('figure');
      if (figure) {
        const caption = figure.querySelector('figcaption');
        if (caption) return caption.textContent.trim();
      }
      const parent = imgEl.parentElement;
      if (parent) {
        const siblings = Array.from(parent.childNodes)
          .filter(n => n.nodeType === Node.TEXT_NODE || (n !== imgEl && n.textContent))
          .map(n => n.textContent.trim())
          .filter(Boolean)
          .join(' ');
        if (siblings.length > 5) return siblings.slice(0, 200);
      }
      return '';
    }

    /**
     * Inject a small description badge below an image for sighted context
     */
    injectDescriptionBadge(imgEl, description) {
      if (imgEl.parentElement?.classList.contains('omni-img-desc-wrapper')) return;

      const wrapper = document.createElement('span');
      wrapper.className = 'omni-img-desc-wrapper';
      wrapper.style.cssText = 'display:inline-block;position:relative;';

      imgEl.parentNode.insertBefore(wrapper, imgEl);
      wrapper.appendChild(imgEl);

      const badge = document.createElement('span');
      badge.className = 'omni-img-desc-badge';
      badge.setAttribute('role', 'note');
      badge.setAttribute('aria-label', `Image description: ${description}`);
      badge.style.cssText = `
        display: block;
        font-size: 11px;
        color: #93c5fd;
        background: rgba(15,23,42,0.85);
        border: 1px solid #3b82f6;
        border-radius: 4px;
        padding: 2px 6px;
        margin-top: 2px;
        max-width: ${Math.max(120, imgEl.offsetWidth)}px;
        word-wrap: break-word;
        line-height: 1.3;
        pointer-events: none;
      `;
      badge.textContent = `🔍 ${description.slice(0, 100)}${description.length > 100 ? '…' : ''}`;
      wrapper.appendChild(badge);
    }

    /**
     * Click handler: enable click-to-describe mode on images
     */
    enableClickToDescribe() {
      document.querySelectorAll('img').forEach(img => {
        img.style.cursor = 'help';
        img.setAttribute('tabindex', img.getAttribute('tabindex') || '0');
        img.setAttribute('title', img.title || 'Click to describe this image with AI');

        const handler = async (e) => {
          e.preventDefault();
          e.stopPropagation();
          // Show visible loading overlay
          img.setAttribute('aria-busy', 'true');
          img.style.outline = '3px solid #3b82f6';
          const loadingDiv = document.createElement('div');
          loadingDiv.className = 'omni-img-loading';
          loadingDiv.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);color:#fff;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:600;z-index:999;border-radius:4px;';
          loadingDiv.textContent = '🔍 Describing…';
          img.style.position = img.style.position || 'relative';
          img.parentElement.style.position = img.parentElement.style.position || 'relative';
          img.parentElement.appendChild(loadingDiv);

          const desc = await this.describeSingleImage(img);
          
          // Remove loading
          loadingDiv.remove();
          img.style.outline = '';
          img.removeAttribute('aria-busy');

          if (desc && desc.length > 3) {
            img.setAttribute('alt', desc);
            img.setAttribute('aria-label', desc);
            img.removeAttribute('data-omni-auto-alt');
            this.described.add(img);
            this.injectDescriptionBadge(img, desc);
            this.announce(desc);
          } else {
            this.announce('Could not generate a description for this image.');
          }
        };

        img._omniDescHandler = handler;
        img.addEventListener('click', handler);
        img.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') handler(e);
        });
      });
    }

    disableClickToDescribe() {
      document.querySelectorAll('img').forEach(img => {
        if (img._omniDescHandler) {
          img.removeEventListener('click', img._omniDescHandler);
          img._omniDescHandler = null;
        }
        img.style.cursor = '';
      });
    }

    /**
     * Announce text via aria-live region
     */
    announce(text) {
      let live = document.getElementById('omni-announce-region');
      if (!live) {
        live = document.createElement('div');
        live.id = 'omni-announce-region';
        live.setAttribute('aria-live', 'assertive');
        live.setAttribute('aria-atomic', 'true');
        live.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden;';
        document.body.appendChild(live);
      }
      live.textContent = '';
      setTimeout(() => { live.textContent = text; }, 50);
    }
  }

  window.OmniImageDescriber = new ImageDescriberEngine();
})();
