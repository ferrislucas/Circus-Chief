#!/usr/bin/env node
import { formatKanbanRecovery, parseRecoveryArguments, runKanbanRecovery } from './kanbanRecoveryCommand.js';

const options = parseRecoveryArguments(process.argv.slice(2));
if (options.error) {
  console.error(options.error);
  process.exitCode = 2;
} else {
  const result = runKanbanRecovery(options);
  console.log(options.json ? JSON.stringify(result, null, 2) : formatKanbanRecovery(result));
  if (!result.report?.ok || result.blocked) process.exitCode = 1;
}
