import type { NfFrameworkPlugin } from '../domain/framework-plugin.contract.js';
import { type ReplacementConfig } from '../domain/adapter-config.contract.js';
import type { SkipList } from '@softarc/native-federation/config';
import { ESBUILD_SKIP_LIST } from '../config/esbuild-skip-list.js';

// Server rendering, test and profiling builds of react-dom must never end up in a browser share.
export const REACT_SKIP_LIST: SkipList = [
  ...ESBUILD_SKIP_LIST,
  /^react-dom\/(server|static)(\.|$)/,
  'react-dom/test-utils',
  'react-dom/profiling',
];

export const reactReplacements: Record<string, Record<string, ReplacementConfig>> = {
  dev: {
    'node_modules/react/index.js': {
      file: 'node_modules/react/cjs/react.development.js',
    },
    'node_modules/react/jsx-dev-runtime.js': {
      file: 'node_modules/react/cjs/react-jsx-dev-runtime.development.js',
    },
    'node_modules/react/jsx-runtime.js': {
      file: 'node_modules/react/cjs/react-jsx-runtime.development.js',
    },
    'node_modules/react-dom/index.js': {
      file: 'node_modules/react-dom/cjs/react-dom.development.js',
    },
  },
  prod: {
    'node_modules/react/index.js': {
      file: 'node_modules/react/cjs/react.production.min.js',
    },
    'node_modules/react/jsx-dev-runtime.js': {
      file: 'node_modules/react/cjs/react-jsx-dev-runtime.production.min.js',
    },
    'node_modules/react/jsx-runtime.js': {
      file: 'node_modules/react/cjs/react-jsx-runtime.production.min.js',
    },
    'node_modules/react-dom/index.js': {
      file: 'node_modules/react-dom/cjs/react-dom.production.min.js',
    },
  },
};

export function reactFrameworkPlugin(): NfFrameworkPlugin {
  return {
    name: 'react',
    fileReplacements: {
      dev: reactReplacements.dev,
      prod: reactReplacements.prod,
    },
    needsCommonJsPlugin: true,
  };
}
