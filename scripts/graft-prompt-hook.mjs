import { registerHooks } from 'node:module';
import { rewriteCruxPrompt } from './graft-prompt-source.mjs';

registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (!url.endsWith('/@nanonets/graft/dist/ai/crux.js')) return loaded;
    return { ...loaded, source: rewriteCruxPrompt(String(loaded.source)) };
  },
});
