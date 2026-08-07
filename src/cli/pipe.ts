import { Command } from 'commander';
import * as readline from 'readline';
import { AppContext } from '../context';
import { RetrievalService } from '../services/retrieval-service';

export function createPipeCommand(): Command {
  return new Command('pipe')
    .description('Run JSON stdio pipe listener for search and context requests')
    .action(async () => {
      const appContext = new AppContext();
      await appContext.initialize();

      const retrievalService = new RetrievalService(appContext);
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
            const projectId = req.project || 'default';
            const result = await retrievalService.queryContext(projectId, req.query, {
              maxTokens: req.maxTokens || 4000,
              expand: req.expand ?? true,
            });
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
