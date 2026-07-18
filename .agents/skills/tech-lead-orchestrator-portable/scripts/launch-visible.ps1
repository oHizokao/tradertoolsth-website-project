param(
    [Parameter(Mandatory = $true)]
    [string]$Config,

    [switch]$DryRun
)

$resolvedConfig = (Resolve-Path -LiteralPath $Config -ErrorAction Stop).Path
$runner = Join-Path $PSScriptRoot 'orchestrate.ps1'
$arguments = @(
    '-NoExit',
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', ('"' + $runner + '"'),
    '--config', ('"' + $resolvedConfig + '"')
)
if ($DryRun) {
    $arguments += '--dry-run'
}

$process = Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -WorkingDirectory (Split-Path -Parent $resolvedConfig) -PassThru
Write-Output "Started visible orchestrator PowerShell with PID $($process.Id)."
