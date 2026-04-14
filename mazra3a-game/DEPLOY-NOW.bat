@echo off
:: ============================================
:: MSDK Farm - نشر تلقائي على Railway
:: شغّل هذا الملف على جهازك (Windows)
:: ============================================

echo.
echo  ╔═══════════════════════════════╗
echo  ║   MSDK Farm - رفع تلقائي      ║
echo  ╚═══════════════════════════════╝
echo.

:: تحقق من Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [!] Node.js غير مثبت - نزّله من https://nodejs.org
    pause
    exit /b 1
)
echo [✓] Node.js موجود

:: تحقق من git
where git >nul 2>nul
if %errorlevel% neq 0 (
    echo [!] Git غير مثبت - نزّله من https://git-scm.com
    pause
    exit /b 1
)
echo [✓] Git موجود

:: تثبيت Railway CLI
echo.
echo [*] تثبيت Railway CLI...
npm install -g @railway/cli
if %errorlevel% neq 0 (
    echo [!] فشل تثبيت Railway CLI
    pause
    exit /b 1
)
echo [✓] Railway CLI جاهز

:: تهيئة Git
echo.
echo [*] تهيئة Git...
git init
git add .
git commit -m "MSDK Farm - Initial deployment"

:: تسجيل الدخول لـ Railway
echo.
echo [*] سجّل دخولك على Railway (ستفتح نافذة المتصفح)...
railway login

:: إنشاء مشروع جديد ونشره
echo.
echo [*] جاري الرفع على Railway...
railway up --detach

echo.
echo [✓] تم الرفع بنجاح!
echo [*] شاهد رابط لعبتك في لوحة Railway
echo     https://railway.app/dashboard
echo.
pause
