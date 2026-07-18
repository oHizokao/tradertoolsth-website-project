#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function option(args, name, required = false) {
  const index = args.indexOf(name);
  if (index === -1) {
    if (required) throw new Error(`${name} is required`);
    return null;
  }
  if (index + 1 >= args.length) throw new Error(`${name} requires a value`);
  return args[index + 1];
}

function loadEnv(filePath) {
  if (!filePath) return;
  const text = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) throw new Error(`Invalid env line in ${filePath}: ${rawLine}`);
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function resolveFrom(base, value) {
  if (!value) return null;
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(base, value);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function tail(text, maxLines = 160) {
  return text.split(/\r?\n/).slice(-maxLines).join('\n');
}

function run(command, args, options) {
  return new Promise((resolve) => {
    const logStream = fs.createWriteStream(options.logPath, { flags: 'a' });
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      shell: false,
      stdio: [options.input ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const capture = (chunk, target) => {
      const text = chunk.toString();
      output += text;
      target.write(text);
      logStream.write(text);
    };
    child.stdout.on('data', (chunk) => capture(chunk, process.stdout));
    child.stderr.on('data', (chunk) => capture(chunk, process.stderr));
    child.on('error', (error) => {
      const message = `[orchestrator] Process error: ${error.message}\n`;
      output += message;
      process.stderr.write(message);
      logStream.write(message);
    });
    child.on('close', (code) => {
      logStream.end(() => resolve({ code: code ?? 1, output }));
    });
    if (options.input) child.stdin.end(options.input);
  });
}

function runCheck(commandText, cwd, logPath) {
  fs.appendFileSync(logPath, `\n$ ${commandText}\n`, 'utf8');
  process.stdout.write(`\n[QA] ${commandText}\n`);
  if (process.platform === 'win32') {
    return run('powershell.exe', ['-NoProfile', '-Command', commandText], { cwd, logPath });
  }
  return run('/bin/sh', ['-lc', commandText], { cwd, logPath });
}

function buildPrompt(task, attempt, previousFailure) {
  if (attempt === 1) {
    return `${task.trim()}\n\nExecution contract:\n- Work only inside the provided project root.\n- Inspect existing code and preserve unrelated changes.\n- Implement the complete task and run focused checks where practical.\n- Do not only explain or propose a patch; directly edit the files.\n- Finish without asking for human clarification.\n`;
  }
  return `${task.trim()}\n\nThis is repair attempt ${attempt}. The previous implementation failed independent QA. Inspect the current working tree and fix the exact failures below without reverting unrelated work. Re-run focused checks and directly edit the files. Finish without asking for human clarification.\n\nPrevious QA failures:\n${tail(previousFailure)}\n`;
}

async function main() {
  const args = process.argv.slice(2);
  const configArg = option(args, '--config', true);
  const dryRun = args.includes('--dry-run');
  const configPath = path.resolve(configArg);
  const configBase = path.dirname(configPath);
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  const projectRoot = resolveFrom(configBase, config.projectRoot);
  const taskFile = resolveFrom(configBase, config.taskFile);
  const envFile = resolveFrom(configBase, config.envFile);
  const logDirectory = resolveFrom(configBase, config.logDirectory || '.orchestrator/logs');
  const maxAttempts = Number(config.maxAttempts ?? 3);
  const checks = config.checkCommands;

  if (!projectRoot || !fs.statSync(projectRoot).isDirectory()) throw new Error('projectRoot must be an existing directory');
  if (!taskFile || !fs.statSync(taskFile).isFile()) throw new Error('taskFile must be an existing file');
  if (!Array.isArray(checks) || checks.length === 0 || checks.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error('checkCommands must contain at least one non-empty command');
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) throw new Error('maxAttempts must be an integer from 1 to 3');
  if (envFile && !fs.existsSync(envFile)) throw new Error(`envFile does not exist: ${envFile}`);

  fs.mkdirSync(logDirectory, { recursive: true });
  const statePath = path.join(logDirectory, 'state.json');
  const runnerPath = path.join(__dirname, 'claude-glm.js');
  const task = fs.readFileSync(taskFile, 'utf8');
  if (!task.trim()) throw new Error('taskFile is empty');

  loadEnv(envFile);
  const baseState = {
    configPath,
    projectRoot,
    taskFile,
    logDirectory,
    maxAttempts,
    checkCommands: checks,
  };

  if (dryRun) {
    writeJson(statePath, { ...baseState, status: 'dry-run-passed', updatedAt: new Date().toISOString() });
    console.log(`[orchestrator] Dry run passed. State: ${statePath}`);
    return;
  }

  if (!process.env.ANTHROPIC_BASE_URL || !(process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY)) {
    throw new Error('GLM provider credentials are missing from the environment or envFile');
  }

  let previousFailure = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const promptPath = path.join(logDirectory, `attempt-${attempt}-prompt.md`);
    const agentLog = path.join(logDirectory, `attempt-${attempt}-agent.log`);
    const qaLog = path.join(logDirectory, `attempt-${attempt}-qa.log`);
    fs.writeFileSync(promptPath, buildPrompt(task, attempt, previousFailure), 'utf8');
    fs.writeFileSync(agentLog, '', 'utf8');
    fs.writeFileSync(qaLog, '', 'utf8');
    writeJson(statePath, {
      ...baseState,
      status: 'agent-running',
      attempt,
      promptPath,
      agentLog,
      qaLog,
      updatedAt: new Date().toISOString(),
    });

    console.log(`\n[orchestrator] GLM attempt ${attempt}/${maxAttempts}`);
    const agent = await run(process.execPath, [runnerPath, '--prompt-file', promptPath], {
      cwd: projectRoot,
      logPath: agentLog,
    });

    const failures = [];
    if (agent.code !== 0) failures.push(`GLM process exited with code ${agent.code}.\n${tail(agent.output, 80)}`);

    writeJson(statePath, {
      ...baseState,
      status: 'qa-running',
      attempt,
      promptPath,
      agentLog,
      qaLog,
      updatedAt: new Date().toISOString(),
    });

    for (const commandText of checks) {
      const result = await runCheck(commandText, projectRoot, qaLog);
      if (result.code !== 0) failures.push(`Command failed (${result.code}): ${commandText}\n${tail(result.output, 100)}`);
    }

    if (failures.length === 0) {
      writeJson(statePath, {
        ...baseState,
        status: 'passed',
        attempt,
        promptPath,
        agentLog,
        qaLog,
        updatedAt: new Date().toISOString(),
      });
      console.log(`\n[orchestrator] PASS after attempt ${attempt}.`);
      return;
    }

    previousFailure = failures.join('\n\n');
    fs.appendFileSync(qaLog, `\n\nFailure summary:\n${previousFailure}\n`, 'utf8');
    writeJson(statePath, {
      ...baseState,
      status: attempt === maxAttempts ? 'failed' : 'revision-pending',
      attempt,
      promptPath,
      agentLog,
      qaLog,
      failureSummary: previousFailure,
      updatedAt: new Date().toISOString(),
    });
    console.error(`\n[orchestrator] Attempt ${attempt} failed QA.`);
  }

  console.error('[orchestrator] Three-attempt stop-loss reached. Deterministic fallback is required.');
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[orchestrator] ${error.message}`);
  process.exitCode = 2;
});
