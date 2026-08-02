import * as osModule from 'os';
import { createRobustEnv } from './nodeSpawnHelper.js';

export function createCommandRunnerEnv(baseEnv = process.env) {
  const env = createRobustEnv(baseEnv);
  delete env.CIRCUSCHIEF_COMMIT_ATTRIBUTION;
  return env;
}

export function wrapCommandForPlatform(command, currentPlatform = osModule.platform()) {
  const cmd = JSON.stringify(command);
  return currentPlatform === 'linux'
    ? `script -q -e -c ${cmd} /dev/null`
    : `script -q /dev/null sh -c ${cmd} < /dev/null`;
}
