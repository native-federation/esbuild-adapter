import { isInSkipList, prepareSkipList } from '@softarc/native-federation/internal';
import { REACT_SKIP_LIST } from './react.js';

describe('REACT_SKIP_LIST', () => {
  const skipList = prepareSkipList(REACT_SKIP_LIST);

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
