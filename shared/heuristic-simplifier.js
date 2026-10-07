/**
 * OmniAccess AI - Heuristic Text Simplifier & Readability Engine
 * Provides 100% on-device, offline-first plain-language text simplification,
 * readability scoring (Flesch-Kincaid), and Bionic Reading formatting.
 */

// Common complex/bureaucratic/academic terms and their plain-language equivalents
const PLAIN_LANGUAGE_DICTIONARY = {
  'accommodate': 'fit',
  'accompany': 'go with',
  'accomplish': 'do',
  'accordance with': 'by',
  'acquire': 'get',
  'additional': 'extra',
  'adjacent to': 'next to',
  'advantageous': 'helpful',
  'adversely impact': 'hurt',
  'afford an opportunity': 'let',
  'aggregate': 'total',
  'allocate': 'give',
  'anticipate': 'expect',
  'apparent': 'clear',
  'approximately': 'about',
  'as a consequence of': 'because',
  'ascertain': 'find out',
  'assistance': 'help',
  'at the present time': 'now',
  'attain': 'reach',
  'attributable to': 'due to',
  'authorize': 'allow',
  'cease': 'stop',
  'circumvent': 'avoid',
  'commence': 'start',
  'compensate': 'pay',
  'component': 'part',
  'comprehend': 'understand',
  'concur': 'agree',
  'consequently': 'so',
  'consolidate': 'join',
  'constitutes': 'is',
  'demonstrate': 'show',
  'depart': 'leave',
  'designate': 'name',
  'discontinue': 'stop',
  'disclose': 'show',
  'disseminate': 'send out',
  'due to the fact that': 'because',
  'eliminate': 'drop',
  'elucidate': 'explain',
  'emphasize': 'stress',
  'encounter': 'meet',
  'endeavor': 'try',
  'enumerate': 'list',
  'equitable': 'fair',
  'equivalent': 'equal',
  'erroneous': 'wrong',
  'evaluate': 'check',
  'evident': 'clear',
  'exclusively': 'only',
  'expedite': 'hurry',
  'facilitate': 'help',
  'feasible': 'possible',
  'for the purpose of': 'to',
  'formulate': 'make',
  'furthermore': 'also',
  'henceforth': 'from now on',
  'implement': 'carry out',
  'in addition': 'also',
  'in advance of': 'before',
  'in accordance with': 'following',
  'in close proximity': 'near',
  'in lieu of': 'instead of',
  'in order to': 'to',
  'in the event that': 'if',
  'inadvertence': 'mistake',
  'inception': 'start',
  'indicate': 'show',
  'initial': 'first',
  'initiate': 'start',
  'magnitude': 'size',
  'maintain': 'keep',
  'maximum': 'most',
  'minimum': 'least',
  'modify': 'change',
  'monitor': 'watch',
  'moreover': 'also',
  'necessitate': 'need',
  'notify': 'tell',
  'numerous': 'many',
  'objective': 'goal',
  'obtain': 'get',
  'optimal': 'best',
  'optimum': 'best',
  'participate': 'take part',
  'pertaining to': 'about',
  'portion': 'part',
  'possess': 'have',
  'preclude': 'prevent',
  'prior to': 'before',
  'proceed': 'go ahead',
  'procure': 'get',
  'proficient': 'skilled',
  'prohibit': 'forbid',
  'promulgate': 'publish',
  'pursuant to': 'under',
  'regarding': 'about',
  'reimburse': 'pay back',
  'remainder': 'rest',
  'remuneration': 'pay',
  'render': 'make',
  'require': 'need',
  'residence': 'home',
  'retain': 'keep',
  'scrutinize': 'look at',
  'solicit': 'ask for',
  'subsequent to': 'after',
  'subsequently': 'later',
  'substantial': 'large',
  'sufficient': 'enough',
  'supplementary': 'extra',
  'terminate': 'end',
  'transmit': 'send',
  'unavailability': 'lack',
  'utilize': 'use',
  'utilization': 'use',
  'viable': 'workable',
  'with reference to': 'about',
  'with regard to': 'about'
};

export class HeuristicSimplifier {
  /**
   * Count syllables in an English word heuristics
   */
  static countSyllables(word) {
    word = word.toLowerCase().replace(/[^a-z]/g, '');
    if (!word) return 0;
    if (word.length <= 3) return 1;

    word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
    word = word.replace(/^y/, '');
    const matches = word.match(/[aeiouy]{1,2}/g);
    return matches ? Math.max(1, matches.length) : 1;
  }

  /**
   * Compute Readability Scores (Flesch-Kincaid Grade Level & Flesch Reading Ease)
   */
  static analyzeReadability(text) {
    const cleanText = text.trim();
    if (!cleanText) {
      return { gradeLevel: 0, readingEase: 100, wordCount: 0, sentenceCount: 0 };
    }

    const sentences = cleanText.split(/[.!?]+(?:\s+|$)/).filter(s => s.trim().length > 0);
    const words = cleanText.split(/\s+/).filter(w => w.length > 0);

    const sentenceCount = Math.max(1, sentences.length);
    const wordCount = Math.max(1, words.length);

    let totalSyllables = 0;
    for (const w of words) {
      totalSyllables += this.countSyllables(w);
    }

    const wordsPerSentence = wordCount / sentenceCount;
    const syllablesPerWord = totalSyllables / wordCount;

    // Flesch Reading Ease: 206.835 - 1.015 * (words/sentences) - 84.6 * (syllables/words)
    let readingEase = 206.835 - (1.015 * wordsPerSentence) - (84.6 * syllablesPerWord);
    readingEase = Math.round(Math.max(0, Math.min(100, readingEase)));

    // Flesch-Kincaid Grade Level: 0.39 * (words/sentences) + 11.8 * (syllables/words) - 15.59
    let gradeLevel = (0.39 * wordsPerSentence) + (11.8 * syllablesPerWord) - 15.59;
    gradeLevel = Math.max(1, Math.round(gradeLevel * 10) / 10);

    return {
      gradeLevel,
      readingEase,
      wordCount,
      sentenceCount,
      readingEaseLabel: this.getReadingEaseLabel(readingEase)
    };
  }

  static getReadingEaseLabel(score) {
    if (score >= 90) return 'Very Easy (5th Grade)';
    if (score >= 80) return 'Easy (6th Grade)';
    if (score >= 70) return 'Fairly Easy (7th Grade)';
    if (score >= 60) return 'Plain English (8th-9th Grade)';
    if (score >= 50) return 'Fairly Difficult (High School)';
    if (score >= 30) return 'Difficult (College)';
    return 'Very Difficult (Graduate Level)';
  }

  /**
   * Simplify text based on selected level:
   * - 'elementary': Grade 3-5 level (short, direct, simple vocabulary)
   * - 'plain': Grade 6-8 level (clear, everyday vocabulary)
   * - 'summary': Extract top key points as an accessible list
   */
  static simplify(text, level = 'plain') {
    if (!text || !text.trim()) return '';

    if (level === 'summary') {
      return this.generateSummary(text);
    }

    // Step 1: Replace complex phrases & vocabulary
    let simplified = text;
    for (const [complex, simple] of Object.entries(PLAIN_LANGUAGE_DICTIONARY)) {
      const regex = new RegExp(`\\b${complex}\\b`, 'gi');
      simplified = simplified.replace(regex, (match) => {
        // preserve capitalization
        if (match[0] === match[0].toUpperCase()) {
          return simple.charAt(0).toUpperCase() + simple.slice(1);
        }
        return simple;
      });
    }

    // Step 2: Split and restructure long sentences
    const sentences = simplified.split(/([.!?]+[\s]+)/);
    const restructured = [];

    for (let i = 0; i < sentences.length; i += 2) {
      let sentence = sentences[i];
      const punctuation = sentences[i + 1] || '';
      if (!sentence.trim()) continue;

      const words = sentence.trim().split(/\s+/);
      const maxWords = (level === 'elementary') ? 14 : 20;

      if (words.length > maxWords) {
        // Split on common connectors
        const splitParts = sentence.split(/,\s+(?:and|but|however|although|whereas|which|while)\s+/i);
        if (splitParts.length > 1) {
          const rebuilt = splitParts.map((p, idx) => {
            const cleanP = p.trim();
            if (!cleanP) return '';
            const capitalized = cleanP.charAt(0).toUpperCase() + cleanP.slice(1);
            return (idx === splitParts.length - 1) ? capitalized : `${capitalized}.`;
          }).filter(Boolean).join(' ');
          restructured.push(rebuilt + punctuation);
          continue;
        }
      }

      restructured.push(sentence + punctuation);
    }

    let result = restructured.join('').trim();

    // Step 3: Elementary level adds spacing and friendly formatting
    if (level === 'elementary') {
      result = result
        .replace(/;\s*/g, '. ')
        .replace(/\s{2,}/g, ' ');
    }

    return result;
  }

  /**
   * Extract top key bullet points for rapid cognitive consumption
   */
  static generateSummary(text, maxPoints = 4) {
    const rawSentences = text.split(/[.!?]+(?:\s+|$)/).filter(s => s.trim().length > 15);
    if (rawSentences.length <= maxPoints) {
      return rawSentences.map(s => `• ${s.trim()}`).join('\n');
    }

    // Heuristic scoring for sentence significance:
    // Favors early sentences, sentences with numbers/metrics, and key action verbs
    const scored = rawSentences.map((sentence, index) => {
      let score = 0;
      // Position bias (earlier sentences convey main ideas)
      if (index === 0) score += 5;
      else if (index === 1) score += 3;
      else if (index === rawSentences.length - 1) score += 2;

      // Length sweet spot (12-25 words)
      const wordCount = sentence.split(/\s+/).length;
      if (wordCount >= 10 && wordCount <= 28) score += 3;

      // Contains metrics or data
      if (/\d+/.test(sentence)) score += 2;

      // Contains key transition words
      if (/\b(important|result|conclude|found|key|shows|because|goal|primary)\b/i.test(sentence)) {
        score += 3;
      }

      return { sentence: sentence.trim(), score, index };
    });

    scored.sort((a, b) => b.score - a.score);
    const topSentences = scored.slice(0, maxPoints).sort((a, b) => a.index - b.index);

    return topSentences.map(item => `• ${this.simplify(item.sentence, 'plain')}`).join('\n');
  }

  /**
   * Format text for Bionic Reading:
   * Bolds the fixation point (first 30-50%) of each word for faster cognitive parsing.
   */
  static toBionicReading(text) {
    if (!text) return '';
    return text.replace(/\b([a-zA-Z0-9]+)\b/g, (word) => {
      const len = word.length;
      if (len <= 1) return word;
      let fixLen = Math.ceil(len * 0.45);
      if (len === 2 || len === 3) fixLen = 1;
      if (len === 4) fixLen = 2;

      const fixation = word.slice(0, fixLen);
      const rest = word.slice(fixLen);
      return `<strong class="omni-bionic-fix">${fixation}</strong>${rest}`;
    });
  }
}
