import type { NfFrameworkPlugin } from '../domain/framework-plugin.contract.js';
import type { SkipList } from '@softarc/native-federation/config';
import { ESBUILD_SKIP_LIST } from '../config/esbuild-skip-list.js';

// Server rendering, test and profiling builds of react-dom must never end up in a browser share.
export const REACT_SKIP_LIST: SkipList = [
  ...ESBUILD_SKIP_LIST,
  /^react-dom\/(server|static)(\.|$)/,
  'react-dom/test-utils',
  'react-dom/profiling',
];

/**
 * @deprecated React needs no preset: the NODE_ENV define picks its dev or prod build and CommonJS
 * interop is always on. Remove it from `frameworks`; keep using `REACT_SKIP_LIST`.
 */
export function reactFrameworkPlugin(): NfFrameworkPlugin {
  return { name: 'react' };
}
