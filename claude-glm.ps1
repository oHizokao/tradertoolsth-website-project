param(
    [Parameter(ValueFromRemainingArguments=$true)]
    [string[]]$CommandArgs
)

if (-not $env:ANTHROPIC_BASE_URL) { $env:ANTHROPIC_BASE_URL = "https://cointh.com/glm/anthropic" }
if (-not $env:ANTHROPIC_AUTH_TOKEN) {
    Write-Host "Set ANTHROPIC_AUTH_TOKEN before running GLM." -ForegroundColor Red
    exit 2
}
if (-not $env:ANTHROPIC_MODEL) { $env:ANTHROPIC_MODEL = "glm-5.2" }
if (-not $env:ANTHROPIC_DEFAULT_OPUS_MODEL) { $env:ANTHROPIC_DEFAULT_OPUS_MODEL = "glm-5.2" }
if (-not $env:ANTHROPIC_DEFAULT_SONNET_MODEL) { $env:ANTHROPIC_DEFAULT_SONNET_MODEL = "glm-5-turbo" }
if (-not $env:ANTHROPIC_DEFAULT_HAIKU_MODEL) { $env:ANTHROPIC_DEFAULT_HAIKU_MODEL = "GLM-4.7" }
if (-not $env:ANTHROPIC_SMALL_FAST_MODEL) { $env:ANTHROPIC_SMALL_FAST_MODEL = "GLM-4.5-Air" }
if (-not $env:CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC) { $env:CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1" }
if (-not $env:CLAUDE_CODE_EFFORT_LEVEL) { $env:CLAUDE_CODE_EFFORT_LEVEL = "max" }

# รันคำสั่ง claude พร้อมกับ arguments ที่ส่งมา
if (Get-Command claude -ErrorAction SilentlyContinue) {
    claude $CommandArgs --permission-mode acceptEdits
} else {
    Write-Host "ไม่พบคำสั่ง 'claude' ในเครื่อง กรุณาติดตั้ง Claude Code CLI (npm install -g @anthropic-ai/claude-code) ก่อนรันคำสั่งนี้" -ForegroundColor Red
}
