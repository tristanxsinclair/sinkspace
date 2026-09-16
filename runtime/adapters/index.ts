import type {
  IntelligenceAdapter
} from './intelligence.js';

import {
  localIntelligenceAdapter
} from './local-intelligence.js';

import {
  OpenAIIntelligenceAdapter
} from './openai-intelligence.js';

export function intelligenceAdapter(): IntelligenceAdapter {
  const mode =
    process.env.SINK_INTELLIGENCE ?? 'local';

  if (mode === 'local') {
    return localIntelligenceAdapter;
  }

  if (mode === 'openai') {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error(
        'OPENAI_API_KEY is required when SINK_INTELLIGENCE=openai'
      );
    }

    return new OpenAIIntelligenceAdapter();
  }

  throw new Error(
    `Unsupported SINK_INTELLIGENCE mode: ${mode}`
  );
}
