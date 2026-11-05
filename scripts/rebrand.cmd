@echo off
rem 把这个项目改成你自己的产品（改名字、副标题、主题色、logo）。
rem
rem   scripts\rebrand.cmd
rem   scripts\rebrand.cmd --name "鸭鸭短剧" --tagline "AI 短剧工厂" --color "#e05a3a"
rem
rem 不带参数会逐项问你。改完记得重编前端：bun run build
setlocal
chcp 65001 >nul
cd /d "%~dp0\.."
if exist "%USERPROFILE%\.bun\bin\bun.exe" set "PATH=%USERPROFILE%\.bun\bin;%PATH%"

where bun >nul 2>nul
if errorlevel 1 (
  echo.
  echo   这台机器还没有装 Bun（运行环境）。
  echo   Windows 上打开 PowerShell，粘这一行回车：
  echo       powershell -c "irm bun.sh/install.ps1 ^| iex"
  echo.
  pause
  exit /b 1
)

call bun scripts/rebrand.ts %*
if errorlevel 1 (
  echo.
  echo [rebrand] 出错了，看上面的提示。
  pause
  exit /b 1
)
pause
