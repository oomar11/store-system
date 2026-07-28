@echo off
chcp 65001 >nul
title نظام المتجر - Store System
cd /d "%~dp0"

echo.
echo  ========================================
echo    جاري تشغيل نظام المتجر...
echo  ========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
    echo  [خطأ] Node.js غير مثبت على الجهاز.
    echo  حمّله من: https://nodejs.org
    pause
    exit /b 1
)

if not exist "node_modules\" (
    echo  جاري تثبيت الحزم لأول مرة... قد يستغرق دقيقة.
    call npm install
    if errorlevel 1 (
        echo  [خطأ] فشل تثبيت الحزم.
        pause
        exit /b 1
    )
    echo.
)

echo  السيرفر هيشتغل على: http://localhost:3000
echo  المتصفح هيفتح لوحده بعد ثواني...
echo  عشان توقف السيرفر: اقفل النافذة دي أو اضغط Ctrl+C
echo.

start "" cmd /c "timeout /t 4 /nobreak >nul && start http://localhost:3000"

call npm run dev

pause
