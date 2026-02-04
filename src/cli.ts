#!/usr/bin/env node
import { Command } from 'commander';
import { createRequire } from 'node:module';
import chalk from 'chalk';
import * as inquirer from '@inquirer/prompts';
import dns from 'dns/promises';
import { jules } from '@google/jules-sdk';
import { resolveApiKey, saveConfigFile } from './config.js';
import { startServer } from './server.js';

const require = createRequire(import.meta.url);
const packageJson = require('../package.json') as { version?: string };

const program = new Command();

program
  .name('jules-mcp-server')
  .description('Jules MCP Server CLI')
  .version(packageJson.version ?? '1.0.0');

program.action(async () => {
  try {
    await startServer();
  } catch (err) {
    console.error('Fatal MCP Server Error:', err);
    process.exit(1);
  }
});

program
  .command('doctor')
  .description('Check environment and configuration health')
  .action(async () => {
    console.log(chalk.bold('Jules MCP Doctor\n'));

    const checks = [
      {
        name: 'Node.js Version',
        check: async () => {
          const version = process.version;
          const major = parseInt(version.replace('v', '').split('.')[0], 10);
          if (major < 18) {
            throw new Error(`Node.js version ${version} is too old. Please upgrade to v18+.`);
          }
          return `v${major} (${version})`;
        },
      },
      {
        name: 'Internet Connectivity',
        check: async () => {
          try {
            await dns.lookup('api.jules.ai');
            return 'Connected';
          } catch {
            await dns.lookup('google.com');
            return 'Connected (via fallback)';
          }
        },
      },
      {
        name: 'API Key Configuration',
        check: async () => {
          const apiKey = resolveApiKey();
          if (!apiKey) {
            throw new Error('JULES_API_KEY is missing. Run `jules-mcp-server config` or set JULES_API_KEY env var.');
          }
          return 'Present';
        },
      },
      {
        name: 'API Connection',
        check: async () => {
          const apiKey = resolveApiKey();
          if (!apiKey) throw new Error('Skipped (No API Key)');
          const client = jules.with({ apiKey });
          await client.sessions({ limit: 1 });
          return 'Authenticated';
        },
      },
    ];

    let hasError = false;

    for (const { name, check } of checks) {
      process.stdout.write(`${name}: `);
      try {
        const result = await check();
        console.log(chalk.green(`✓ ${result}`));
      } catch (error: any) {
        hasError = true;
        console.log(chalk.red('✗ Failed'));
        console.log(chalk.dim(`  ${error.message || error}`));
      }
    }

    console.log();
    if (hasError) {
      console.log(chalk.red('Doctor found issues. Please resolve them before proceeding.'));
      process.exit(1);
    } else {
      console.log(chalk.green('All checks passed! Your environment is ready.'));
    }
  });

program
  .command('config')
  .description('Configure the Jules API Key')
  .option('-k, --key <api-key>', 'API key to save (skips interactive prompt)')
  .action(async (options: { key?: string }) => {
    try {
      let apiKey: string;

      if (options.key !== undefined) {
        if (!options.key.trim()) {
          console.error(chalk.red('Error: API Key cannot be empty'));
          process.exit(1);
        }
        apiKey = options.key;
      } else {
        apiKey = await inquirer.password({
          message: 'Enter your Jules API Key:',
          mask: '*',
          validate: (input) => input.trim().length > 0 || 'API Key cannot be empty',
        });
      }

      saveConfigFile({ apiKey });
      console.log(chalk.green('✓ Configuration saved successfully.'));
    } catch (error: any) {
      if (error instanceof Error && error.name === 'ExitPromptError') {
        console.log(chalk.yellow('\nConfiguration cancelled.'));
      } else {
        console.error(chalk.red('Failed to save configuration:'), error);
      }
    }
  });

program.parse(process.argv);
