# OmniAccess AI — Accessibility Chrome Extension

**AI-powered digital accessibility assistant for Chrome** that helps people with visual, hearing, motor, and cognitive disabilities interact with any web content through alternative input and output methods.

---

## 🚀 Features

### 🗣️ Voice-Controlled Navigation
- Say **"click login"**, **"scroll down"**, **"fill search with hello"**, **"go back"**
- Interactive numbered badge overlay: **"show numbers"** → **"click 4"**
- Continuous or push-to-talk recognition modes
- Real-time voice HUD with transcript display

### 🖼️ AI Image & Page Descriptions
- Describes charts, graphs, UI layouts, and memes aloud
- Powered by **Gemini Vision API** with offline heuristic fallback
- Auto-detects image type (chart/UI/meme/general) for contextual descriptions
- Click-to-describe mode for individual images
- Injects missing `alt` text and `aria-label` automatically

### 📖 Text Simplifier
- **3 reading levels**: Elementary (Grade 4), Plain English (Grade 8), Summary (bullet points)
- **Dyslexia-friendly fonts**: Lexend, Atkinson Hyperlegible, OpenDyslexic
- **Bionic Reading** mode (bold word-fixation points)
- **Read Aloud** with word-by-word highlighting, speed/pitch/voice control
- Flesch-Kincaid readability scoring
- Powered by Gemini LLM or 100% offline heuristic engine

### ♿ WCAG 2.2 Auditor
- Checks: missing alt text, contrast < 4.5:1, missing form labels, heading hierarchy, vague links, unlabeled buttons, small touch targets (< 24px)
- **Auto-fix**: injects alt text, aria-labels, skip navigation links
- Visual report panel with severity colors (error/warning/notice)
- Click any issue to scroll-and-highlight the offending element

### 🎙️ Live Captions
- Real-time speech-to-text overlay for web video/audio
- Speaker change detection with **Speaker 1/2/3** labels
- Sound labels: **[Music]**, **[Laughter]**, **[Applause]**
- Draggable, resizable caption box
- Adjustable font size (small/medium/large)

### 🧭 Multimodal Input
| Input Method | Description |
|---|---|
| **Voice** | Web Speech API continuous recognition |
| **Gaze** | Webcam-based pupil tracking with dwell-click |
| **Switch Access** | Keyboard/button scanner with auto-scan |
| **Touch/Mouse** | Standard + large target mode |

### 🔊 Multimodal Output
| Output Method | Description |
|---|---|
| **Audio chimes** | Web Audio API sonification for all actions |
| **Read Aloud** | Word-highlighted SpeechSynthesis |
| **Live Captions** | Real-time speech-to-text overlay |
| **High Contrast** | Yellow-on-black, white-on-black themes |
| **Visual Alerts** | Screen flash for notifications |
| **Haptic feedback** | Vibration patterns on mobile |

### 🔒 Privacy-First
- **100% on-device processing** for gaze tracking, switch access, heuristic simplification
- Gemini API calls only happen when you configure an API key
- Webcam video is processed locally in Canvas memory — never uploaded
- Chrome Built-in AI (Prompt API) used when available for zero-network LLM
- Offline mode for all core features

---

## 📁 Project Structure

```
OmniAccess AI/
├── manifest.json                    # MV3 extension manifest
├── background/
│   └── service-worker.js            # Background service worker (settings, messaging)
├── content/
│   ├── content-main.js              # Main content script orchestrator
│   ├── voice-nav.js                 # Voice recognition & navigation engine
│   ├── gaze-tracker.js              # Webcam gaze & head gesture tracker
│   ├── live-captions.js             # Live speech-to-text captions
│   ├── switch-access.js             # Switch scanning engine
│   ├── wcag-auditor.js              # WCAG 2.2 accessibility checker
│   ├── read-aloud.js                # Word-highlighted read aloud engine
│   ├── image-describer.js           # AI vision image descriptions
│   ├── text-simplifier.js           # LLM + heuristic text simplification
│   ├── overlay.css                  # All injected UI styles
│   └── fonts.css                    # Dyslexia fonts & typography
├── sidepanel/
│   ├── index.html                   # Side panel main UI (WCAG AA)
│   ├── sidepanel.css                # Side panel styles (dark theme)
│   └── sidepanel.js                 # Side panel controller
├── shared/
│   ├── config.js                    # Default profiles & voice command dict
│   ├── gemini-api.js                # Gemini VLM & LLM API integration
│   ├── heuristic-simplifier.js      # Offline-first text simplification
│   ├── audio-chimes.js              # Web Audio API sonification
│   └── storage-manager.js           # chrome.storage sync/local manager
├── icons/
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
└── scripts/
    └── generate_icons.py            # Icon generation utility
```

---

## 🛠️ Installation (Developer Mode)

1. Open Chrome → `chrome://extensions`
2. Enable **Developer Mode** (top right toggle)
3. Click **Load unpacked**
4. Select this folder: `C:\Users\Arnav\Documents\Think  AI TCET`
5. The extension icon appears in the Chrome toolbar
6. Click the icon → Side Panel opens with all settings

---

## ⚙️ Configuration

### Gemini API Key (for AI features)
1. Get a free API key at [ai.google.dev](https://ai.google.dev)
2. Open OmniAccess AI side panel → **AI & Tools** tab
3. Paste your key and click **Save Key**
4. Click **Test Key** to verify
5. Now image descriptions, text simplification, and chart reading use Gemini AI

### Accessibility Profiles
Switch between preset profiles:
- **Low Vision** — high contrast + large cursor + zoom
- **Blind / Screen Reader** — voice nav + auto-describe images + audio chimes
- **Motor / Switch** — switch scanning + gaze + voice
- **Cognitive / Dyslexia** — Bionic Reading + Lexend font + text simplification
- **Deaf / Hard of Hearing** — live captions + sound labels + visual alerts
- **Custom** — mix and match any settings

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Alt + A` | Toggle floating dock |
| `Alt + V` | Toggle voice navigation |
| `Alt + R` | Read page aloud |
| `Alt + S` | Stop reading |

---

## 🎤 Voice Commands

| Say | Action |
|---|---|
| `"click [element]"` | Click button/link by name |
| `"scroll down"` / `"scroll up"` | Scroll page |
| `"show numbers"` | Show numbered markers |
| `"click 4"` | Click element #4 |
| `"fill search with hello"` | Fill form field |
| `"read page"` | Start read aloud |
| `"stop reading"` | Stop read aloud |
| `"audit page"` | Run WCAG audit |
| `"simplify text"` | Simplify page text |
| `"describe image"` | AI image descriptions |
| `"toggle contrast"` | Toggle high contrast |
| `"help"` | List all commands |

---

## 🧩 Technology Stack

| Feature | Technology |
|---|---|
| Speech recognition | Web Speech API (SpeechRecognition) |
| Text-to-speech | Web Speech API (SpeechSynthesis) |
| Image descriptions | Gemini 1.5 Flash / gemini-2.0-flash Vision API |
| Text simplification | Gemini API + Chrome Built-in AI (Prompt API) + Heuristic engine |
| Gaze tracking | Browser Canvas + WebGL pixel analysis (privacy-first) |
| Audio feedback | Web Audio API (no external files) |
| Storage | chrome.storage.sync + local (cross-device sync) |
| Extension | Manifest V3, Chrome APIs |

---

## 🔮 Roadmap

- [ ] MediaPipe Face Mesh integration for precise gaze tracking
- [ ] Whisper API alternative for speech recognition
- [ ] Page narration with positional audio cues
- [ ] Export accessibility audit report as PDF
- [ ] Multi-language voice command support
- [ ] Screen magnifier lens
- [ ] Color blindness simulation & correction filters

---

## 📜 License

MIT License — Built for the Think AI TCET Hackathon

---

*OmniAccess AI is itself built to be accessible: the extension UI follows WCAG 2.2 AA guidelines, all controls have proper labels, and the interface is fully keyboard-navigable.*
