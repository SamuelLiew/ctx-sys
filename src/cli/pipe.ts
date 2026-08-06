import { Command } from 'commander';
import * as readline from 'readline';
import { searchHybrid } from '../search/hybrid';
import { assembleContext } from '../search/context';
import { AppContext } from '../context';

export function createPipeCommand(): Command {
  return new Command('pipe')
    .description('Run JSON stdio pipe listener for search and context requests')
    .action(async () => {
      const appContext = new AppContext();
      await appContext.initialize();

      const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

      try {
        for await (const line of rl) {
          if (!line.trim()) continue;
          let req: any;
          try {
            req = JSON.parse(line);
          } catch {
            console.log(JSON.stringify({ ok: false, error: 'invalid_json' }));
            continue;
          }

          try {
            const opts = { ...req, appContext };
            const result = req.action === 'context'
              ? await assembleContext(req.query, opts)
              : await searchHybrid(req.query, opts);
            console.log(JSON.stringify({ ok: true, data: result }));
          } catch (e: any) {
            console.log(JSON.stringify({ ok: false, error: e.message }));
          }
        }
      } finally {
        await appContext.close();
      }
    });
}
