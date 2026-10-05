param([ValidateSet('api','worker','migrate','test','smoke')][string]$Action = 'api')
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRoot
$taskPython = Join-Path $taskRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $taskPython)) { throw 'Run scripts/setup.ps1 first.' }
switch ($Action) {
    'api' {
        & $taskPython -m alembic upgrade head
        if ($LASTEXITCODE -ne 0) { throw 'Database migration failed.' }
        $taskPreviousCookieSetting = $env:SESSION_COOKIE_SECURE
        try {
            $env:SESSION_COOKIE_SECURE = 'false'
            & $taskPython -m uvicorn app.main:app --host 127.0.0.1 --port 8000
        } finally {
            $env:SESSION_COOKIE_SECURE = $taskPreviousCookieSetting
        }
    }
    'worker' { & $taskPython -m app.worker }
    'migrate' { & $taskPython -m alembic upgrade head }
    'test' { & $taskPython -m pytest -q }
    'smoke' { & $taskPython -m scripts.smoke_test }
}
if ($LASTEXITCODE -ne 0) { throw "Backend command failed: $Action" }
