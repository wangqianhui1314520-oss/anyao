@echo off
chcp 65001 >nul
title 安药 · 三端实时联动
cd /d "%~dp0"
rem 优先用包内自带的 Node（无需安装），没有再用系统里的
set NODE=%~dp0runtime\node.exe
if not exist "%NODE%" (
  where node >nul 2>nul || (echo 缺少 runtime\node.exe，也没有安装 Node.js 18+：https://nodejs.org & pause & exit /b 1)
  set NODE=node
)
rem 已经在运行：直接打开大屏
netstat -ano | findstr /r /c:":4200 .*LISTENING" >nul 2>nul && (
  set /p KEY=<"%~dp0data\key.txt"
  call echo 联动服务已在运行，正在打开大屏…
  call start "" "http://127.0.0.1:4200/?k=%%KEY%%"
  timeout /t 3 >nul
  exit /b 0
)
set ADB=
for %%A in (adb.exe) do if not "%%~$PATH:A"=="" set ADB=%%~$PATH:A
if exist "E:\Android\Sdk\platform-tools\adb.exe" set ADB=E:\Android\Sdk\platform-tools\adb.exe
if defined ADB "%ADB%" reverse tcp:4200 tcp:4200 >nul 2>nul && echo 已为 USB 连接的手机建立端口转发。
echo 首次运行时如 Windows 防火墙询问，请允许“专用网络”，手机才能通过 Wi-Fi 连接。
echo 大屏会自动在浏览器打开；关闭本窗口即停止服务。
"%NODE%" server.cjs
pause
