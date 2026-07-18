const { spawn } = require('child_process');
const path = require('path');

// Anthropic-compatible GLM provider. Supply the token through the environment.
process.env.ANTHROPIC_BASE_URL ||= 'https://cointh.com/glm/anthropic';
if (!process.env.ANTHROPIC_AUTH_TOKEN && !process.env.ANTHROPIC_API_KEY) {
    console.error('[Tech Lead Orchestrator] Set ANTHROPIC_AUTH_TOKEN before running GLM.');
    process.exit(2);
}
process.env.ANTHROPIC_AUTH_TOKEN ||= process.env.ANTHROPIC_API_KEY;
process.env.ANTHROPIC_MODEL ||= 'glm-5.2';
process.env.ANTHROPIC_DEFAULT_OPUS_MODEL ||= 'glm-5.2';
process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
process.env.CLAUDE_CODE_EFFORT_LEVEL ||= 'max';

const args = process.argv.slice(2);
if (!args.includes('--permission-mode')) {
    args.push('--permission-mode', 'acceptEdits');
}

console.log('[Tech Lead Orchestrator] Starting GLM-5.2...');

const isWindows = process.platform === 'win32';
const command = isWindows ? 'powershell.exe' : 'claude';
const commandArgs = isWindows
    ? [
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', path.join(process.env.APPDATA || '', 'npm', 'claude.ps1'),
        ...args,
    ]
    : args;
const child = spawn(command, commandArgs, { stdio: 'inherit', shell: false });

let minutes = 1;
const timer = setInterval(() => {
    console.log(`\n[Heartbeat] GLM-5.2 is still working: minute ${minutes}.`);
    minutes += 1;
}, 60000);

child.on('error', (error) => {
    clearInterval(timer);
    console.error(`[Tech Lead Orchestrator] Could not start GLM-5.2: ${error.message}`);
    process.exit(1);
});

child.on('close', (code) => {
    clearInterval(timer);
    console.log(`\n[Tech Lead Orchestrator] GLM-5.2 finished with exit code: ${code}`);
    console.log('[Tech Lead Orchestrator] Start QA and verification.');
    process.exit(code ?? 1);
});
