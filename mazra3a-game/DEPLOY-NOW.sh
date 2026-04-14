#!/bin/bash
# ============================================
# MSDK Farm - نشر تلقائي على Railway
# شغّل هذا الملف على Mac أو Linux أو VPS
# ============================================

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
echo -e "\n${GREEN}╔═══════════════════════════════╗${NC}"
echo -e "${GREEN}║   MSDK Farm - رفع تلقائي      ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════╝${NC}\n"

# تحقق من Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}[!] Node.js غير مثبت${NC}"
    echo "    نزّله من: https://nodejs.org"
    exit 1
fi
echo -e "${GREEN}[✓] Node.js: $(node --version)${NC}"

# تحقق من git
if ! command -v git &> /dev/null; then
    echo -e "${RED}[!] Git غير مثبت${NC}"
    exit 1
fi
echo -e "${GREEN}[✓] Git موجود${NC}"

# تثبيت Railway CLI
echo -e "\n${YELLOW}[*] تثبيت Railway CLI...${NC}"
npm install -g @railway/cli
echo -e "${GREEN}[✓] Railway CLI جاهز${NC}"

# تهيئة Git إذا لم يكن موجوداً
if [ ! -d ".git" ]; then
    echo -e "\n${YELLOW}[*] تهيئة Git...${NC}"
    git init
    git add .
    git commit -m "MSDK Farm - Initial deployment"
    echo -e "${GREEN}[✓] Git جاهز${NC}"
fi

# تسجيل الدخول لـ Railway
echo -e "\n${YELLOW}[*] سجّل دخولك على Railway...${NC}"
railway login

# نشر المشروع
echo -e "\n${YELLOW}[*] جاري الرفع على Railway...${NC}"
railway up --detach

echo -e "\n${GREEN}[✓] تم الرفع بنجاح!${NC}"
echo -e "${YELLOW}[*] افتح لوحة Railway لتشاهد رابط لعبتك:${NC}"
echo -e "    https://railway.app/dashboard\n"
