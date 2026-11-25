$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $projectRoot
try {
    & ./.venv/Scripts/python.exe -m PyInstaller --noconfirm --windowed --onedir --name JD-to-CV --add-data 'webapp/public;webapp/public' --add-data 'webapp/prompts.json;webapp' desktop/launcher.py
    if ($LASTEXITCODE -ne 0) { throw 'Desktop build failed' }
    Copy-Item -LiteralPath LICENSE -Destination dist/JD-to-CV/LICENSE.txt
    Copy-Item -LiteralPath docs/THIRD_PARTY_NOTICES.md -Destination dist/JD-to-CV/THIRD_PARTY_NOTICES.md
    New-Item -ItemType Directory -Path dist/JD-to-CV/licenses -Force | Out-Null
    $pythonBase = & ./.venv/Scripts/python.exe -c 'import sys; print(sys.base_prefix)'
    Copy-Item -LiteralPath (Join-Path $pythonBase 'LICENSE.txt') -Destination dist/JD-to-CV/licenses/Python-LICENSE.txt
    Copy-Item -LiteralPath (Join-Path $pythonBase 'tcl/tk8.6/license.terms') -Destination dist/JD-to-CV/licenses/Tk-license.terms
    Compress-Archive -Path dist/JD-to-CV -DestinationPath dist/JD-to-CV-Windows.zip -Force
} finally { Pop-Location }
