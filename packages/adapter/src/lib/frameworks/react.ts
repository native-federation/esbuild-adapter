import type { NfFrameworkPlugin } from '../domain/framework-plugin.contract.js';
import { reactReplacements } from '../utils/react-replacements.js';

export function reactFrameworkPlugin(): NfFrameworkPlugin {
  return {
    name: 'react',
    fileReplacements: {
      dev: reactReplacements.dev,
      prod: reactReplacements.prod,
    },
    compensateExports: [/\/react\//],
    needsCommonJsPlugin: true,
  };
}
