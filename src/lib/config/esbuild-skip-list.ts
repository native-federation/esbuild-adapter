import { DEFAULT_SKIP_LIST, type SkipList } from '@softarc/native-federation/config';

// DEFAULT_SKIP_LIST matches strings exactly, so it only covers this package's root entry.
export const ESBUILD_SKIP_LIST: SkipList = [
  ...DEFAULT_SKIP_LIST,
  '@softarc/native-federation-esbuild/config',
  '@softarc/native-federation-esbuild/domain',
  '@softarc/native-federation-esbuild/frameworks/react',
];
