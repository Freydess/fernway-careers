param([string]$PythonPath = 'python')
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRoot
if (-not (Test-Path -LiteralPath '.venv\Scripts\python.exe')) {
    & $PythonPath -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw 'Virtual environment creation failed. Use Python 3.12 or newer.' }
}
& '.\.venv\Scripts\python.exe' -m pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
& '.\.venv\Scripts\python.exe' scripts/init_env.py
if ($LASTEXITCODE -ne 0) { throw 'Environment configuration failed.' }
& '.\.venv\Scripts\python.exe' -m alembic upgrade head
if ($LASTEXITCODE -ne 0) { throw 'Database migration failed.' }
Write-Output 'Backend ready. Run .\scripts\run.ps1 api'
