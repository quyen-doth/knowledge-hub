import { WatcherError } from '../errors';
import { parseBrowserSourceConfig, type SourceAdapter } from './types';

export const browserAdapter: SourceAdapter = {
  async discover(source) {
    parseBrowserSourceConfig(source);
    throw new WatcherError('BROWSER_ADAPTER_NOT_IMPLEMENTED');
  },
};
