# OmniAccess AI - Accessibility Chrome Extension

AI-powered digital accessibility assistant for Google Chrome that helps people with visual, hearing, motor, and cognitive disabilities interact with any web content through alternative input and output methods.

Repository Links:
- Think AI 4.0: https://github.com/Arnav-GC/Think-AI-4.0-Accessibility
- New Think AI: https://github.com/Arnav-GC/New-Think-AI-

---

## Features

### Voice-Controlled Navigation
- Natural command navigation: "click login", "scroll down", "fill search with hello", "go back"
- Interactive numbered badge overlay: "show numbers" followed by "click 4"
- Continuous listening mode and push-to-talk activation
- Real-time HUD overlay showing transcribed utterance and command state

### AI Image and Page Descriptions
- Generates descriptive alt text for charts, graphs, UI layouts, diagrams, and memes
- Supported AI providers: Groq (Qwen vision), Google Gemini (Gemini 2.0 Flash), and xAI Grok
- Context-aware detection categorizes imagery as chart, UI, meme, or general photo
- Click-to-describe interaction on individual images with live progress indicators
- Injects missing standard alt attributes and ARIA labels into page DOM

### Text Simplification and Reading Enhancements
- Three reading comprehension targets: Elementary (Grade 4), Plain English (Grade 8), and Summary (bullet points)
- Open-access dyslexia typefaces: Lexend, Atkinson Hyperlegible, and OpenDyslexic
- Bionic Reading mode with bold fixation points to accelerate reading speed
- Read Aloud engine with word-by-word visual tracking, configurable voice, speed, and pitch
- Blue Light Filter overlay with customizable intensity for nocturnal comfort
- Reading ruler and expanded text spacing options

### WCAG 2.2 Auditor
- Automated evaluation: missing alternative text, contrast ratios below 4.5:1, unassociated form inputs, broken heading order, ambiguous link names, small touch targets below 24x24 px
- One-click auto-fix: injects placeholder labels, accessible ARIA roles, and skip-to-content landmarks
- Visual interactive report categorized by severity: errors, warnings, and notices
- Direct element inspection with automated scroll-and-highlight targeting

### Live Captions
- Low-latency speech-to-text captions overlay for browser audio and video playback
- Speaker change detection providing numbered speaker attribution
- Context sound indicators: [Music], [Laughter], [Applause]
- Draggable and resizable caption HUD with customizable typography size

### Multimodal Input Options

| Input Method | Technology and Function |
|---|---|
| Voice Control | Web Speech API continuous recognition and custom grammar matching |
| Gaze Tracking | In-browser pupil luminance analysis via Canvas API with dwell-click activation |
| Switch Access | Single-key or multi-switch automatic scanning with custom scan intervals |
| Touch and Pointer | Standard input plus enlarged hit targets and high-visibility focus indicators |

### Multimodal Output Options

| Output Method | Technology and Function |
|---|---|
| Audio Chimes | Synthesized tones via Web Audio API providing non-visual state cues |
| Read Aloud | SpeechSynthesis API with real-time word boundary highlights |
| Live Captions | Floating HUD transcript for media and ambient dialogue |
| Contrast Themes | High contrast dark, light, and yellow-on-black color schemes |
| Visual Alerts | Screen flash notifications designed for deaf and hard-of-hearing users |
| Haptic Feedback | Vibration patterns on supported touch devices |

### Privacy and Security Architecture
- 100% on-device processing for gaze tracking, switch scanning, and heuristic text processing
- Webcam video remains strictly inside local Canvas memory and is never recorded or streamed
- Network requests to AI endpoints occur only when an explicit API key is configured by the user
- Fallback heuristic engines operate completely offline without external network dependencies

---

## Project Structure

```
OmniAccess AI/
|-- manifest.json                    # Manifest V3 extension configuration
|-- background/
|   `-- service-worker.js            # Background service worker (state, storage, CORS fetcher)
|-- content/
|   |-- content-main.js              # Content script coordinator and dock injector
|   |-- voice-nav.js                 # Speech recognition and navigation command parser
|   |-- gaze-tracker.js              # Webcam pupil tracking and dwell activation
|   |-- live-captions.js             # Live speech transcription HUD
|   |-- switch-access.js             # Switch scanning engine
|   |-- wcag-auditor.js              # WCAG 2.2 compliance validator
|   |-- read-aloud.js                # SpeechSynthesis TTS with word-level highlight
|   |-- image-describer.js           # Multimodal vision image description engine
|   |-- text-simplifier.js           # LLM and heuristic simplification engine
|   |-- overlay.css                  # UI styles for all page overlays and HUDs
|   `-- fonts.css                    # Dyslexia-friendly typefaces
|-- sidepanel/
|   |-- index.html                   # Side panel interface (WCAG 2.2 AA compliant)
|   |-- sidepanel.css                # Dark theme side panel design system
|   `-- sidepanel.js                 # Side panel state and event controller
|-- shared/
|   |-- config.js                    # Accessibility profiles and command dictionaries
|   |-- gemini-api.js                # Groq, Gemini, and Grok API client
|   |-- heuristic-simplifier.js      # Rule-based offline text simplification
|   |-- audio-chimes.js              # Web Audio tone synthesizer
|   `-- storage-manager.js           # Chrome storage synchronization utilities
|-- icons/
|   |-- icon-16.png
|   |-- icon-48.png
|   `-- icon-128.png
`-- scripts/
    `-- generate_icons.py            # PNG icon generation script
```

---

## Installation and Setup

### Web Portal and Interactive Demo
Visit the hosted demonstration portal:
https://arnav-gc.github.io/Think-AI-4.0-Accessibility/

### Manual Installation from Repository:
1. Clone this repository or download and extract `omniaccess-ai-extension.zip`.
2. Open Google Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** using the toggle in the upper right corner.
4. Click **Load unpacked** in the top navigation bar.
5. Select the folder containing `manifest.json`.
6. Pin **OmniAccess AI** to the browser toolbar for quick access.

---

## Configuration

### AI Providers (Optional)
To use advanced vision descriptions or LLM simplification:
1. Obtain an API key from one of the supported providers:
   - Groq: https://console.groq.com (Default model: openai/gpt-oss-20b for text, qwen/qwen3.8-27b for vision)
   - Google AI Studio: https://aistudio.google.com (Gemini 2.0 Flash)
   - xAI: https://console.x.ai (Grok)
2. Open the OmniAccess AI side panel and select the **AI & Tools** tab.
3. Select your provider, enter the key, and select **Save Key**.
4. Select **Test Key** to confirm connectivity.

Core assistive features including switch access, gaze tracking, offline contrast themes, read aloud, and offline heuristic simplification remain fully functional without any API key.

### Accessibility Profiles
Pre-configured profiles allow one-click setup:
- **Low Vision**: High contrast, enlarged cursor, custom zoom scaling
- **Blind / Screen Reader**: Voice navigation, image narration, audio sonification
- **Motor / Switch Access**: Automated scanning, dwell gaze input, enlarged tap areas
- **Cognitive / Dyslexia**: Bionic Reading, Lexend font, reduced reading level
- **Deaf / Hard of Hearing**: Live caption HUD, sound labels, visual alert flash
- **Custom**: Granular manual adjustment of every setting

---

## Keyboard Shortcuts

| Key Combination | Action |
|---|---|
| `Alt + A` | Toggle floating accessibility toolbar |
| `Alt + V` | Toggle microphone voice control |
| `Alt + R` | Start reading page aloud |
| `Alt + S` | Stop text-to-speech reading |

---

## Voice Commands Reference

| Spoken Phrase | Action |
|---|---|
| "click [element name]" | Click link or button matching text |
| "show numbers" | Display numbered badge overlays on interactive elements |
| "click [number]" | Trigger click on specific badge number |
| "scroll down" / "scroll up" | Scroll page view |
| "scroll to top" / "scroll to bottom" | Jump to extreme page boundaries |
| "fill [field] with [text]" | Enter text into matching input fields |
| "read page" | Narrate visible page content |
| "stop reading" | Silence speech narration |
| "audit page" | Execute WCAG 2.2 accessibility scan |
| "simplify text" | Simplify selected or page content |
| "describe image" | Request AI description of on-screen imagery |
| "toggle contrast" | Switch high contrast mode |
| "toggle captions" | Open or close Live Captions HUD |
| "help" | Read list of supported voice commands |

---

## Technical Architecture

| Component | Technical Implementation |
|---|---|
| Speech Recognition | Web Speech API SpeechRecognition interface |
| Text-to-Speech | Web Speech API SpeechSynthesis interface |
| Computer Vision | Groq vision API (qwen/qwen3.8-27b) and Google Gemini Vision |
| Language Modeling | Groq (openai/gpt-oss-20b), Google Gemini, xAI Grok, and local heuristic parser |
| Gaze Tracking | HTML5 Canvas pixel differential analysis with dynamic calibration |
| Audio Feedback | Web Audio API OscillatorNode and GainNode synthesis |
| Storage and Sync | chrome.storage.sync with fallback to chrome.storage.local |
| Extension Framework | Chrome Manifest V3, Service Workers, Content Script Isolation |

---

## License

This project is licensed under the MIT License. Developed for the Think AI TCET Hackathon.
