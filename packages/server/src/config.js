import { homedir } from 'os';
import { join } from 'path';

export function getDefaultDbPath() {
  return join(homedir(), '.circuschief', 'circuschief.db');
}
