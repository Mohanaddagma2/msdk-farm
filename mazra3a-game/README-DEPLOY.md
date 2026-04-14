# MSDK Farm - دليل النشر

## التشغيل المحلي
```bash
cd mazra3a-game
node server.js
# → http://localhost:3000
```

## النشر على Railway (مجاني / مدفوع)
1. اذهب إلى https://railway.app وسجل بحساب GitHub
2. اضغط "New Project" → "Deploy from GitHub repo"
3. ارفع الملفات لمستودع GitHub جديد
4. Railway سيكشف Node.js تلقائياً ويشغل `node server.js`
5. أضف المتغيرات في Settings → Variables:
   - `PORT` = `3000`
   - `WALLET_USDT` = عنوان محفظتك USDT TRC20
   - `WALLET_BTC` = عنوان محفظتك BTC
   - `WALLET_ETH` = عنوان محفظتك ETH

## النشر على Render (مجاني)
1. اذهب إلى https://render.com وسجل
2. اضغط "New Web Service"
3. اربط مستودع GitHub
4. Build Command: (اتركه فارغ)
5. Start Command: `node server.js`
6. أضف Environment Variables

## النشر على VPS (DigitalOcean / Vultr / Hetzner)
```bash
# 1. اشترِ VPS (أرخص خيار ~$4/شهر)
# 2. اتصل بالسيرفر
ssh root@YOUR_SERVER_IP

# 3. ثبت Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# 4. ارفع الملفات
# يمكنك استخدام git clone أو scp

# 5. شغل اللعبة
cd mazra3a-game
PORT=80 ADMIN_USERNAME=MSDK node server.js

# 6. للتشغيل الدائم استخدم pm2
npm install -g pm2
PORT=80 pm2 start server.js --name msdk-farm
pm2 save
pm2 startup
```

## بيانات الأدمن
- اسم المستخدم: `MSDK`
- كلمة المرور: `Mohanad1!`

## المتغيرات البيئية
| المتغير | الوصف | الافتراضي |
|---------|-------|----------|
| PORT | منفذ السيرفر | 3000 |
| WALLET_USDT | عنوان محفظة USDT TRC20 | عنوان افتراضي |
| WALLET_BTC | عنوان محفظة BTC | عنوان افتراضي |
| WALLET_ETH | عنوان محفظة ETH | عنوان افتراضي |

## ملاحظات مهمة
- غيّر عناوين المحافظ الافتراضية بعناوينك الحقيقية
- البيانات تُحفظ في `data/gamedata.json` - تأكد من عمل نسخ احتياطية
- لا يوجد أي مكتبات خارجية - Node.js فقط
