param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$CommandArgs
)

$runner = Join-Path $PSScriptRoot 'orchestrate.js'
& node $runner @CommandArgs
exit $LASTEXITCODE
