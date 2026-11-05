@echo off
rem 一条命令装好并启动。
rem
rem   scripts\setup.cmd          自己用（不需要登录，打开就能用）
rem   scripts\setup.cmd multi    给别人用（要登录、开放注册、局域网可访问）
rem
rem 第一次会装依赖 + 编网页，大概 1-3 分钟。之后再跑就只要几秒。
setlocal enabledelayedexpansion
chcp 65001 >nul
cd /d "%~dp0\.."
if exist "%USERPROFILE%\.bun\bin\bun.exe" set "PATH=%USERPROFILE%\.bun\bin;%PATH%"

set "MODE=%~1"
if "%MODE%"=="" set "MODE=single"

where bun >nul 2>nul
if errorlevel 1 (
  echo.
  echo   这台机器还没有装 Bun（运行环境）。
  echo.
  echo   Windows 上打开 PowerShell，粘这一行回车：
  echo       powershell -c "irm bun.sh/install.ps1 ^| iex"
  echo   装完关掉重开这个窗口，再跑一次本脚本。
  echo.
  pause
  exit /b 1
)

echo.
echo [geekreel] 安装依赖（第一次会久一点）
call bun install
if errorlevel 1 (
  echo [geekreel] 依赖安装失败，把上面的红字发给懂电脑的朋友。
  pause
  exit /b 1
)

if /i "%MODE%"=="multi" (
  if not exist ".env" (
    copy /y ".env.example" ".env" >nul
    set "CODE=GR!RANDOM!!RANDOM!"
    powershell -NoProfile -Command "$p='.env'; $t=Get-Content $p -Raw -Encoding UTF8; $t=$t -replace 'VW_MULTI_USER=0','VW_MULTI_USER=1' -replace 'VW_ALLOW_REGISTER=0','VW_ALLOW_REGISTER=1' -replace 'VW_HOST=127.0.0.1','VW_HOST=0.0.0.0' -replace '# VW_REGISTER_CODE=.*','VW_REGISTER_CODE=!CODE!'; Set-Content $p $t -Encoding UTF8"
    echo [geekreel] 已生成 .env（多人模式）。邀请码：!CODE!
  ) else (
    echo [geekreel] 沿用已有的 .env
  )
) else (
  echo [geekreel] 单机模式：不需要登录，打开就能用
)

echo.
echo [geekreel] 编译网页
call bun run --filter=@vw/web build
if errorlevel 1 (
  echo [geekreel] 编译失败。
  pause
  exit /b 1
)

echo.
if /i "%MODE%"=="multi" (
  echo [geekreel] 启动中。同一个局域网的人访问：http://本机IP:4780
  echo [geekreel] 第一个注册的账号会自动成为管理员
) else (
  echo [geekreel] 启动中。浏览器打开 http://127.0.0.1:4780
)
echo [geekreel] 关掉这个窗口或按 Ctrl+C 就停止
echo.

call bun apps/server/src/index.ts
pause
