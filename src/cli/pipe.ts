import { Command } from 'commander';
import * as readline from 'readline';
import { searchHybrid } from '../search/hybrid';
import { assembleContext } from '../search/context';

export function createPipeCommand(): Command {
  return new Command('pipe')
    .description('Run JSON stdio pipe listener for search and context requests')
    .action(() => {
      const rl = readline.createInterface({ input: process.stdin });

      rl.on('line', async (line) => {
        let req: any;
        try { req = JSON.parse(line); } catch {
          console.log(JSON.stringify({ ok: false, error: 'invalid_json' }));
          return;
        }

        try {
          const result = req.action === 'context'
            ? await assembleContext(req.query, req)
            : await searchHybrid(req.query, req);
          console.log(JSON.stringify({ ok: true, data: result }));
        } catch (e: any) {
          console.log(JSON.stringify({ ok: false, error: e.message }));
        }
      });
    });
}
