#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function takeOption(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  if (index + 1 >= args.length) throw new Error(`${name} requires a value`);
  const value = args[index + 1];
  args.splice(index, 2);
  return value;
}

function mask(value) {
  if (!value) return '(missing)';
  if (value.length < 9) return '***';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

const args = process.argv.slice(2);
const dryRunIndex = args.indexOf('--dry-run');
const dryRun = dryRunIndex !== -1;
if (dryRun) args.splice(dryRunIndex, 1);

let prompt = null;
try {
  const promptFile = takeOption(args, '--prompt-file');
  if (promptFile) prompt = fs.readFileSync(path.resolve(promptFile), 'utf8');
} catch (error) {
  console.error(`[GLM runner] ${error.message}`);
  process.exit(2);
}

const baseUrl = process.env.ANTHROPIC_BASE_URL;
const authToken = process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY;
if (!baseUrl || !authToken) {
  console.error('[GLM runner] ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN (or ANTHROPIC_API_KEY) are required.');
  process.exit(2);
}

process.env.ANTHROPIC_MODEL ||= 'glm-5.2';
process.env.ANTHROPIC_DEFAULT_OPUS_MODEL ||= process.env.ANTHROPIC_MODEL;
process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC ||= '1';
process.env.CLAUDE_CODE_EFFORT_LEVEL ||= 'max';

if (!args.includes('--permission-mode') && !args.includes('--dangerously-skip-permissions')) {
  args.push('--permission-mode', 'acceptEdits');
}
if (prompt && !args.includes('-p') && !args.includes('--print')) args.unshift('-p');

const configuredCommand = process.env.CLAUDE_CLI_COMMAND;
let command;
let commandArgs;

if (configuredCommand) {
  command = configuredCommand;
  commandArgs = args;
} else if (process.platform === 'win32') {
  const npmClaude = path.join(process.env.APPDATA || '', 'npm', 'claude.ps1');
  if (fs.existsSync(npmClaude)) {
    command = 'powershell.exe';
    commandArgs = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', npmClaude, ...args];
  } else {
    command = 'claude';
    commandArgs = args;
  }
} else {
  command = 'claude';
  commandArgs = args;
}

console.log(`[GLM runner] Provider: ${baseUrl}`);
console.log(`[GLM runner] Model: ${process.env.ANTHROPIC_MODEL}`);
console.log(`[GLM runner] Token: ${mask(authToken)}`);
console.log(`[GLM runner] Command: ${command}`);

if (dryRun) {
  console.log('[GLM runner] Dry run passed; no agent was started.');
  process.exit(0);
}

const child = spawn(command, commandArgs, {
  cwd: process.cwd(),
  env: process.env,
  shell: false,
  stdio: [prompt ? 'pipe' : 'inherit', 'inherit', 'inherit'],
});

if (prompt) child.stdin.end(prompt);

const heartbeatSeconds = Math.max(10, Number(process.env.ORCHESTRATOR_HEARTBEAT_SECONDS || 60));
let elapsed = heartbeatSeconds;
const timer = setInterval(() => {
  console.log(`[GLM runner] Still working (${elapsed}s elapsed)...`);
  elapsed += heartbeatSeconds;
}, heartbeatSeconds * 1000);

function forward(signal) {
  if (!child.killed) child.kill(signal);
}
process.on('SIGINT', () => forward('SIGINT'));
process.on('SIGTERM', () => forward('SIGTERM'));

child.on('error', (error) => {
  clearInterval(timer);
  console.error(`[GLM runner] Could not start Claude Code: ${error.message}`);
  process.exit(1);
});

child.on('close', (code) => {
  clearInterval(timer);
  console.log(`[GLM runner] Finished with exit code ${code ?? 1}.`);
  process.exit(code ?? 1);
});
