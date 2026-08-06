/**
 * F10.9: CLI command for LLM relationship extraction.
 */

import { Command } from 'commander';
import { CLIOutput, defaultOutput } from './init';

export function createExtractRelCommand(output: CLIOutput = defaultOutput): Command {
  const cmd = new Command('extract-rel')
    .description('Use LLM to discover relationships between existing entities')
    .option('-p, --project <path>', 'Project directory', '.')
    .option('--type <type>', 'Only process entities of this type')
    .option('--limit <n>', 'Max entities to process', '50')
    .option('--dry-run', 'Show what would be extracted without saving', false)
    .option('-d, --db <path>', 'Custom database path')
    .option('-q, --quiet', 'Suppress output', false)
    .action(async () => {
      output.log('LLM relationship extraction is disabled in zero-network mode.');
    });

  return cmd;
}
