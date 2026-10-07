/**
 * OmniAccess AI - Configuration and Defaults
 * Defines default profiles, WCAG standards, voice command dictionaries, and model configs.
 */

export const DEFAULT_CONFIG = {
  // Active Profile: 'low_vision' | 'blind_screen_reader' | 'motor_switch' | 'cognitive_dyslexia' | 'deaf_hard_of_hearing' | 'custom'
  activeProfile: 'custom',

  // Personal Accessibility Profiles
  profiles: {
    low_vision: {
      name: 'Low Vision / High Contrast',
      highContrast: true,
      contrastTheme: 'yellow-black', // 'yellow-black' | 'white-black' | 'black-white'
      largeCursor: true,
      zoomLevel: 120,
      autoFixContrast: true,
      readingRuler: false,
      dyslexiaFont: false,
      bionicReading: false,
      voiceNav: false,
      gazeTracking: false,
      switchAccess: false,
      liveCaptions: false,
      readAloudSpeed: 1.0,
      simplifyLevel: 'standard',
    },
    blind_screen_reader: {
      name: 'Blind / Screen Reader Optimized',
      voiceNav: true,
      audioChimes: true,
      autoDescribeImages: true,
      autoInjectSkipLinks: true,
      autoInjectAriaLabels: true,
      highContrast: false,
      readingRuler: false,
      dyslexiaFont: false,
      bionicReading: false,
      gazeTracking: false,
      switchAccess: false,
      liveCaptions: false,
      readAloudSpeed: 1.1,
      simplifyLevel: 'standard',
    },
    motor_switch: {
      name: 'Motor / Switch & Gaze Control',
      switchAccess: true,
      switchScanSpeed: 2.0, // seconds per item
      switchScanMode: 'auto', // 'auto' | 'manual'
      gazeTracking: false,
      gazeDwellTime: 1.5, // seconds dwell for click
      largeTargets: true, // expand touch/click targets to 48px
      voiceNav: true,
      autoFocusRings: true,
      audioChimes: true,
      highContrast: false,
      dyslexiaFont: false,
      bionicReading: false,
      liveCaptions: false,
      readAloudSpeed: 1.0,
      simplifyLevel: 'standard',
    },
    cognitive_dyslexia: {
      name: 'Cognitive & Dyslexia Friendly',
      dyslexiaFont: true,
      fontFamily: 'OpenDyslexic', // 'OpenDyslexic' | 'Lexend' | 'Atkinson'
      bionicReading: true,
      readingRuler: true,
      simplifyLevel: 'elementary', // 'elementary' | 'plain' | 'summary'
      textSpacing: true, // enhanced line & word spacing
      audioChimes: true,
      readAloudSpeed: 0.9,
      highContrast: false,
      voiceNav: false,
      gazeTracking: false,
      switchAccess: false,
      liveCaptions: false,
    },
    deaf_hard_of_hearing: {
      name: 'Deaf & Hard of Hearing',
      liveCaptions: true,
      captionFontSize: 'medium', // 'small' | 'medium' | 'large'
      captionTheme: 'high-contrast-dark',
      soundLabels: true, // show [Music], [Laughter], [Applause]
      visualAlerts: true, // screen flashes on notification/alert
      highContrast: false,
      dyslexiaFont: false,
      bionicReading: false,
      readingRuler: false,
      voiceNav: false,
      gazeTracking: false,
      switchAccess: false,
      readAloudSpeed: 1.0,
      simplifyLevel: 'standard',
    },
    custom: {
      name: 'Custom Profile',
      highContrast: false,
      contrastTheme: 'yellow-black',
      largeCursor: false,
      zoomLevel: 100,
      dyslexiaFont: false,
      fontFamily: 'Lexend',
      bionicReading: false,
      readingRuler: false,
      textSpacing: false,
      simplifyLevel: 'plain',
      voiceNav: false,
      gazeTracking: false,
      gazeDwellTime: 1.5,
      switchAccess: false,
      switchScanSpeed: 2.0,
      switchScanMode: 'auto',
      largeTargets: false,
      liveCaptions: false,
      captionFontSize: 'medium',
      captionTheme: 'high-contrast-dark',
      soundLabels: true,
      visualAlerts: false,
      audioChimes: true,
      autoFixContrast: false,
      autoInjectAriaLabels: false,
      autoInjectSkipLinks: true,
      autoFocusRings: true,
      readAloudSpeed: 1.0,
      readAloudPitch: 1.0,
      hapticFeedback: true,
    }
  },

  // Active settings (merged from active profile)
  settings: {
    // Input modalities
    voiceNav: false,
    voiceListeningMode: 'continuous', // 'continuous' | 'push_to_talk'
    gazeTracking: false,
    gazeDwellTime: 1.5,
    switchAccess: false,
    switchScanSpeed: 2.0,
    switchScanMode: 'auto',
    switchKey: 'Space', // 'Space' | 'Enter'
    largeTargets: false,

    // Output modalities
    audioChimes: true,
    readAloudSpeed: 1.0,
    readAloudPitch: 1.0,
    readAloudVoice: 'default',
    liveCaptions: false,
    captionFontSize: 'medium',
    captionTheme: 'high-contrast-dark',
    soundLabels: true,
    visualAlerts: false,
    hapticFeedback: true,

    // Visual & Cognitive
    highContrast: false,
    contrastTheme: 'yellow-black',
    largeCursor: false,
    zoomLevel: 100,
    dyslexiaFont: false,
    fontFamily: 'Lexend',
    bionicReading: false,
    readingRuler: false,
    textSpacing: false,
    simplifyLevel: 'plain', // 'elementary' | 'plain' | 'summary'

    // WCAG Auto-Fixes
    autoFixContrast: false,
    autoInjectAriaLabels: false,
    autoInjectSkipLinks: true,
    autoFocusRings: true,

    // AI & Privacy
    preferOfflineAI: true,
    geminiApiKey: '',
    geminiModel: 'gemini-2.0-flash',
    whisperApiKey: '',
    showFloatingDock: true,
  }
};

export const VOICE_COMMANDS = [
  { intent: 'CLICK', patterns: [/^click\s+(.+)$/i, /^press\s+(.+)$/i, /^select\s+(.+)$/i, /^open\s+(.+)$/i] },
  { intent: 'SHOW_HINTS', patterns: [/^(show\s+numbers|show\s+hints|number\s+elements|show\s+markers)$/i] },
  { intent: 'HIDE_HINTS', patterns: [/^(hide\s+numbers|hide\s+hints|clear\s+markers)$/i] },
  { intent: 'SCROLL_DOWN', patterns: [/^(scroll\s+down|down|page\s+down)$/i] },
  { intent: 'SCROLL_UP', patterns: [/^(scroll\s+up|up|page\s+up)$/i] },
  { intent: 'SCROLL_TOP', patterns: [/^(scroll\s+to\s+top|go\s+to\s+top|top)$/i] },
  { intent: 'SCROLL_BOTTOM', patterns: [/^(scroll\s+to\s+bottom|go\s+to\s+bottom|bottom)$/i] },
  { intent: 'NAV_BACK', patterns: [/^(go\s+back|back|previous\s+page)$/i] },
  { intent: 'NAV_FORWARD', patterns: [/^(go\s+forward|forward|next\s+page)$/i] },
  { intent: 'NAV_RELOAD', patterns: [/^(reload|refresh|refresh\s+page)$/i] },
  { intent: 'FILL_FORM', patterns: [/^fill\s+(.+?)\s+with\s+(.+)$/i, /^type\s+(.+?)\s+into\s+(.+)$/i] },
  { intent: 'READ_PAGE', patterns: [/^(read\s+page|read\s+aloud|read\s+this|speak|start\s+reading)$/i] },
  { intent: 'STOP_READING', patterns: [/^(stop\s+reading|stop|pause\s+reading|be\s+quiet|shut\s+up)$/i] },
  { intent: 'AUDIT_PAGE', patterns: [/^(audit\s+page|check\s+accessibility|run\s+audit|wcag\s+audit)$/i] },
  { intent: 'AUTO_FIX', patterns: [/^(auto\s*fix|fix\s+page|fix\s+accessibility|fix\s+issues)$/i] },
  { intent: 'SIMPLIFY_TEXT', patterns: [/^(simplify\s+text|make\s+simple|easier\s+reading|plain\s+text)$/i] },
  { intent: 'DESCRIBE_IMAGE', patterns: [/^(describe\s+image|read\s+chart|explain\s+image|describe\s+meme|image\s+description)$/i] },
  { intent: 'TOGGLE_HIGH_CONTRAST', patterns: [/^(toggle\s+contrast|high\s+contrast|dark\s+mode)$/i] },
  { intent: 'TOGGLE_DYSLEXIA_FONT', patterns: [/^(dyslexia\s+font|dyslexic\s+font|change\s+font)$/i] },
  { intent: 'TOGGLE_CAPTIONS', patterns: [/^(toggle\s+captions|captions\s+on|captions\s+off|subtitles)$/i] },
  { intent: 'HELP', patterns: [/^(help|what\s+can\s+i\s+say|voice\s+commands)$/i] }
];

export const WCAG_RULES = {
  CONTRAST_NORMAL: 4.5,
  CONTRAST_LARGE: 3.0,
  TARGET_MIN_SIZE: 24, // WCAG 2.2 Level AA
  TARGET_RECOMMENDED_SIZE: 48, // AAA / Mobile standard
};
