import type { SkipList } from '@softarc/native-federation/config';
import { REACT_SKIP_LIST } from './react.js';

// Mirrors core's isInSkipList (not exported): strings match exactly, regexes and functions test.
const isInSkipList = (pkg: string, skipList: SkipList) =>
  skipList.some(entry =>
    typeof entry === 'string'
      ? entry === pkg
      : typeof entry === 'function'
        ? entry(pkg)
        : entry.test(pkg)
  );

describe('REACT_SKIP_LIST', () => {
  const skipList = REACT_SKIP_LIST;

  it.each([
    '@softarc/native-federation-esbuild',
    '@softarc/native-federation-esbuild/config',
    'react-dom/server',
    'react-dom/server.browser',
    'react-dom/static.edge',
    'react-dom/test-utils',
    'react-dom/profiling',
  ])('skips %s', pkg => {
    expect(isInSkipList(pkg, skipList)).toBe(true);
  });

  // react-dom/serverless is a made-up name that guards the regex against prefix matches.
  it.each(['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', 'react-dom/serverless'])(
    'keeps %s',
    pkg => {
      expect(isInSkipList(pkg, skipList)).toBe(false);
    }
  );
});
