/**
 * MSDK Farm - Full-Stack Backend
 * Express + Socket.IO + SQLite
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const compression = require('compression');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const { Database: _SQLiteDB } = require('node-sqlite3-wasm');
// Compatibility wrapper: accept variadic args like better-sqlite3
function wrapStmt(stmt) {
  const normalize = (args) => args.length === 1 && (Array.isArray(args[0]) || (args[0] !== null && typeof args[0] === 'object')) ? args[0] : args;
  const origRun = stmt.run.bind(stmt);
  const origGet = stmt.get.bind(stmt);
  const origAll = stmt.all.bind(stmt);
  stmt.run = (...a) => origRun(normalize(a));
  stmt.get = (...a) => origGet(normalize(a));
  stmt.all = (...a) => origAll(normalize(a));
  return stmt;
}
class Database extends _SQLiteDB {
  prepare(sql) { return wrapStmt(super.prepare(sql)); }
}

// تحميل ملف .env إن وجد
try { require('dotenv').config?.(); } catch(e) {}

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production-' + Math.random().toString(36).slice(2);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// ======================== قاعدة البيانات ========================
// على Railway: استخدم volume mount path إن وُجد، وإلا في الجذر
const DB_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.DB_DIR || __dirname;
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
const DB_PATH = path.join(DB_DIR, 'msdk.db');
console.log('📊 قاعدة البيانات على:', DB_PATH);
const db = new Database(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    type TEXT DEFAULT 'player',
    created_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    msdk INTEGER DEFAULT 800,
    xp INTEGER DEFAULT 0,
    level INTEGER DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS game_state (
    user_id INTEGER PRIMARY KEY,
    state_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS market_listings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seller_id INTEGER NOT NULL,
    seller_name TEXT NOT NULL,
    item TEXT NOT NULL,
    qty INTEGER NOT NULL,
    price INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    status TEXT DEFAULT 'active',
    FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_market_status ON market_listings(status);
  CREATE INDEX IF NOT EXISTS idx_market_item ON market_listings(item);

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    amount INTEGER NOT NULL,
    item TEXT,
    qty INTEGER,
    note TEXT,
    counterparty TEXT,
    time INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id);

  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    user_name TEXT NOT NULL,
    text TEXT NOT NULL,
    time INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS admin_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    user_name TEXT,
    action TEXT NOT NULL,
    details TEXT,
    time INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS crypto_deposits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    network TEXT NOT NULL,
    currency TEXT NOT NULL,
    tx_hash TEXT UNIQUE NOT NULL,
    from_address TEXT,
    amount_crypto REAL NOT NULL,
    amount_msdk INTEGER NOT NULL,
    status TEXT DEFAULT 'confirmed',
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_deposits_user ON crypto_deposits(user_id);
`);

/* ====================== إعدادات الكريبتو ====================== */
const DEPOSIT_TRX_ADDRESS = process.env.DEPOSIT_TRX_ADDRESS || '';
const DEPOSIT_BSC_ADDRESS = process.env.DEPOSIT_BSC_ADDRESS || '';
const MSDK_RATE_PER_USDT = parseInt(process.env.MSDK_RATE_PER_USDT || '1000', 10); // 1 USDT = 1000 MSDK
const MSDK_RATE_PER_TRX  = parseInt(process.env.MSDK_RATE_PER_TRX  || '100',  10); // 1 TRX  ≈ 0.1$ → 100 MSDK
const MSDK_RATE_PER_BNB  = parseInt(process.env.MSDK_RATE_PER_BNB  || '500000', 10); // 1 BNB ≈ $500
const USDT_TRC20_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'; // عقد USDT الرسمي على Tron

// أنشئ حساب الأدمن إن لم يوجد
const adminExists = db.prepare("SELECT id FROM users WHERE name = 'admin'").get();
if (!adminExists) {
  const hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
  const now = Date.now();
  db.prepare(`INSERT INTO users (name, password_hash, type, created_at, last_seen, msdk)
              VALUES (?, ?, 'admin', ?, ?, 100000)`)
    .run('admin', hash, now, now);
  console.log('✅ تم إنشاء حساب admin (كلمة المرور:', ADMIN_PASSWORD, ')');
}

// ======================== الـ Express ========================
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET','POST'] },
});

app.use(compression());
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// تحديد المعدل لمنع الإساءة
const authLimiter = rateLimit({ windowMs: 60_000, max: 10 });
const apiLimiter  = rateLimit({ windowMs: 60_000, max: 240 });
app.use('/api/auth/', authLimiter);
app.use('/api/',     apiLimiter);

// ============== مساعدات ==============
function makeToken(user){
  return jwt.sign({ id: user.id, name: user.name, type: user.type }, JWT_SECRET, { expiresIn: '30d' });
}
function authMiddleware(req, res, next){
  const auth = req.headers.authorization || '';
  const token = auth.replace(/^Bearer\s+/, '');
  if (!token) return res.status(401).json({ error: 'مطلوب تسجيل الدخول' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, name, type, msdk, xp, level FROM users WHERE id = ?').get(decoded.id);
    if (!user) return res.status(401).json({ error: 'مستخدم غير موجود' });
    req.user = user;
    db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(Date.now(), user.id);
    next();
  } catch(e) {
    return res.status(401).json({ error: 'token غير صحيح' });
  }
}
function adminOnly(req, res, next){
  if (req.user?.type !== 'admin') return res.status(403).json({ error: 'صلاحيات أدمن مطلوبة' });
  next();
}
function logAdmin(userId, userName, action, details=''){
  db.prepare('INSERT INTO admin_log (user_id, user_name, action, details, time) VALUES (?, ?, ?, ?, ?)')
    .run(userId, userName, action, details, Date.now());
}
function recordTx(userId, type, amount, item=null, qty=null, note='', counterparty=''){
  db.prepare(`INSERT INTO transactions (user_id, type, amount, item, qty, note, counterparty, time)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(userId, type, amount, item, qty, note, counterparty, Date.now());
}

// ======================== مسارات المصادقة ========================
app.post('/api/auth/register', (req, res) => {
  const { name, password } = req.body || {};
  if (!name || !password) return res.status(400).json({ error: 'اسم وكلمة مرور مطلوبان' });
  if (name.length < 2 || name.length > 20) return res.status(400).json({ error: 'الاسم بين 2 و 20 حرف' });
  if (password.length < 4) return res.status(400).json({ error: 'كلمة مرور قصيرة (4 على الأقل)' });
  const existing = db.prepare('SELECT id FROM users WHERE name = ?').get(name);
  if (existing) return res.status(409).json({ error: 'الاسم محجوز' });
  const hash = bcrypt.hashSync(password, 10);
  const now = Date.now();
  const result = db.prepare(`INSERT INTO users (name, password_hash, created_at, last_seen)
                             VALUES (?, ?, ?, ?)`).run(name, hash, now, now);
  const user = db.prepare('SELECT id, name, type, msdk, xp, level FROM users WHERE id = ?').get(result.lastInsertRowid);
  const token = makeToken(user);
  logAdmin(user.id, name, 'تسجيل', '');
  res.json({ token, user });
});

app.post('/api/auth/login', (req, res) => {
  const { name, password } = req.body || {};
  if (!name || !password) return res.status(400).json({ error: 'اسم وكلمة مرور مطلوبان' });
  const user = db.prepare('SELECT * FROM users WHERE name = ?').get(name);
  if (!user) return res.status(401).json({ error: 'بيانات خاطئة' });
  if (!bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'بيانات خاطئة' });
  }
  db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(Date.now(), user.id);
  const safeUser = { id: user.id, name: user.name, type: user.type, msdk: user.msdk, xp: user.xp, level: user.level };
  const token = makeToken(safeUser);
  logAdmin(user.id, user.name, 'تسجيل دخول', '');
  res.json({ token, user: safeUser });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

// ======================== حالة اللعبة ========================
app.get('/api/game/state', authMiddleware, (req, res) => {
  const row = db.prepare('SELECT state_json FROM game_state WHERE user_id = ?').get(req.user.id);
  if (!row) return res.json({ state: null });
  try { res.json({ state: JSON.parse(row.state_json) }); }
  catch(e){ res.json({ state: null }); }
});

app.post('/api/game/state', authMiddleware, (req, res) => {
  const state = req.body?.state;
  if (!state || typeof state !== 'object') return res.status(400).json({ error: 'state مطلوب' });
  const json = JSON.stringify(state);
  if (json.length > 1024 * 1024) return res.status(413).json({ error: 'حجم state كبير جداً' });
  // حدّث المستخدم بالقيم الأساسية لعرضها للأدمن
  if (typeof state.msdk === 'number')
    db.prepare('UPDATE users SET msdk = ?, xp = ?, level = ? WHERE id = ?')
      .run(state.msdk|0, state.xp|0, state.level|1, req.user.id);
  db.prepare(`INSERT INTO game_state (user_id, state_json, updated_at) VALUES (?, ?, ?)
              ON CONFLICT(user_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`)
    .run(req.user.id, json, Date.now());
  res.json({ ok: true });
});

// ======================== السوق - عرض و طلب ========================
app.get('/api/market', authMiddleware, (req, res) => {
  const { item, sort = 'priceAsc' } = req.query;
  let q = `SELECT id, seller_id, seller_name, item, qty, price, created_at, expires_at
           FROM market_listings WHERE status = 'active' AND expires_at > ?`;
  const params = [Date.now()];
  if (item && item !== 'all') { q += ' AND item = ?'; params.push(item); }
  // ترتيب
  if (sort === 'priceAsc')   q += ' ORDER BY price ASC';
  else if (sort === 'priceDesc') q += ' ORDER BY price DESC';
  else if (sort === 'qtyDesc')   q += ' ORDER BY qty DESC';
  else if (sort === 'qtyAsc')    q += ' ORDER BY qty ASC';
  else                            q += ' ORDER BY created_at DESC';
  q += ' LIMIT 200';
  const listings = db.prepare(q).all(...params);
  res.json({ listings });
});

// إحصائيات السوق
app.get('/api/market/stats', authMiddleware, (req, res) => {
  const stats = db.prepare(`
    SELECT item, COUNT(*) as listings, SUM(qty) as total_qty,
           MIN(price) as min_price, MAX(price) as max_price,
           AVG(price) as avg_price
    FROM market_listings WHERE status = 'active' AND expires_at > ?
    GROUP BY item
  `).all(Date.now());
  res.json({ stats });
});

// قوائمي
app.get('/api/market/mine', authMiddleware, (req, res) => {
  const listings = db.prepare(`SELECT * FROM market_listings WHERE seller_id = ? AND status IN ('active','sold')
                               ORDER BY created_at DESC LIMIT 100`).all(req.user.id);
  res.json({ listings });
});

// عرض سلعة في السوق
app.post('/api/market/list', authMiddleware, (req, res) => {
  const { item, qty, price } = req.body || {};
  if (!item || !qty || !price) return res.status(400).json({ error: 'بيانات ناقصة' });
  if (qty <= 0 || price <= 0) return res.status(400).json({ error: 'قيم غير صالحة' });
  if (qty > 999 || price > 1_000_000_000) return res.status(400).json({ error: 'قيم خارج النطاق' });
  // تحقق من مخزون اللاعب من state
  const row = db.prepare('SELECT state_json FROM game_state WHERE user_id = ?').get(req.user.id);
  if (!row) return res.status(400).json({ error: 'لم يتم حفظ حالة اللعبة بعد' });
  const state = JSON.parse(row.state_json);
  const inv = { ...(state.crops||{}), ...(state.products||{}) };
  if ((inv[item]||0) < qty) return res.status(400).json({ error: 'لا تملك هذه الكمية' });
  // اخصم من state
  if (state.crops?.[item] >= qty) {
    state.crops[item] -= qty;
    if (state.crops[item] <= 0) delete state.crops[item];
  } else if (state.products?.[item] >= qty) {
    state.products[item] -= qty;
    if (state.products[item] <= 0) delete state.products[item];
  }
  db.prepare('UPDATE game_state SET state_json = ?, updated_at = ? WHERE user_id = ?')
    .run(JSON.stringify(state), Date.now(), req.user.id);
  // أضف عرض السوق
  const expires = Date.now() + 24*60*60*1000;
  const result = db.prepare(`INSERT INTO market_listings
    (seller_id, seller_name, item, qty, price, created_at, expires_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`)
    .run(req.user.id, req.user.name, item, qty, price, Date.now(), expires);
  recordTx(req.user.id, 'list', 0, item, qty, `سعر: ${price}/قطعة`);
  // أعلِم الجميع بالعرض الجديد
  io.emit('market:update', { type:'new', listingId: result.lastInsertRowid });
  res.json({ ok: true, listingId: result.lastInsertRowid });
});

// شراء من السوق
app.post('/api/market/buy/:id', authMiddleware, (req, res) => {
  const listingId = parseInt(req.params.id, 10);
  const tx = db.transaction(() => {
    const listing = db.prepare(`SELECT * FROM market_listings WHERE id = ? AND status = 'active'`).get(listingId);
    if (!listing) throw new Error('العرض غير موجود أو انتهى');
    if (listing.expires_at < Date.now()) throw new Error('العرض منتهي الصلاحية');
    if (listing.seller_id === req.user.id) throw new Error('لا يمكنك شراء عرضك');
    const total = listing.price * listing.qty;
    const buyer = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (buyer.msdk < total) throw new Error('رصيد غير كافٍ');
    // اخصم من المشتري
    db.prepare('UPDATE users SET msdk = msdk - ? WHERE id = ?').run(total, req.user.id);
    // أضف للبائع
    db.prepare('UPDATE users SET msdk = msdk + ? WHERE id = ?').run(total, listing.seller_id);
    // حدّث العرض
    db.prepare(`UPDATE market_listings SET status = 'sold' WHERE id = ?`).run(listingId);
    // أضف للمخزون في state اللاعب
    const buyerStateRow = db.prepare('SELECT state_json FROM game_state WHERE user_id = ?').get(req.user.id);
    if (buyerStateRow) {
      const state = JSON.parse(buyerStateRow.state_json);
      // المحاصيل العادية تذهب لـ crops، منتجات المصانع لـ products
      const isFactoryProduct = ['flour','cornmeal','bread','cake','cheese','butter','yogurt','fabric','sweater','juice','jam','wine'].includes(listing.item);
      const target = isFactoryProduct ? 'products' : 'crops';
      state[target] = state[target] || {};
      state[target][listing.item] = (state[target][listing.item]||0) + listing.qty;
      state.msdk = (state.msdk||0) - total;
      db.prepare('UPDATE game_state SET state_json = ?, updated_at = ? WHERE user_id = ?')
        .run(JSON.stringify(state), Date.now(), req.user.id);
    }
    // أضف للبائع state - زيادة msdk
    const sellerStateRow = db.prepare('SELECT state_json FROM game_state WHERE user_id = ?').get(listing.seller_id);
    if (sellerStateRow) {
      const sellerState = JSON.parse(sellerStateRow.state_json);
      sellerState.msdk = (sellerState.msdk||0) + total;
      db.prepare('UPDATE game_state SET state_json = ?, updated_at = ? WHERE user_id = ?')
        .run(JSON.stringify(sellerState), Date.now(), listing.seller_id);
    }
    recordTx(req.user.id, 'buy',  -total, listing.item, listing.qty, '', listing.seller_name);
    recordTx(listing.seller_id, 'sell', total, listing.item, listing.qty, '', req.user.name);
    return { listing, total };
  });
  try {
    const { listing, total } = tx();
    io.emit('market:update', { type:'sold', listingId });
    // أعلم البائع
    io.to('user:'+listing.seller_id).emit('notify', {
      type: 'sale',
      msg: `💰 بيعت سلعتك (${listing.qty}× ${listing.item}) بـ ${total} MSDK`,
    });
    res.json({ ok: true, total });
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

// إلغاء عرض
app.post('/api/market/cancel/:id', authMiddleware, (req, res) => {
  const listingId = parseInt(req.params.id, 10);
  const listing = db.prepare(`SELECT * FROM market_listings WHERE id = ? AND status = 'active' AND seller_id = ?`)
                    .get(listingId, req.user.id);
  if (!listing) return res.status(404).json({ error: 'العرض غير موجود' });
  // أرجع السلعة للبائع
  const stateRow = db.prepare('SELECT state_json FROM game_state WHERE user_id = ?').get(req.user.id);
  if (stateRow) {
    const state = JSON.parse(stateRow.state_json);
    const isFactoryProduct = ['flour','cornmeal','bread','cake','cheese','butter','yogurt','fabric','sweater','juice','jam','wine'].includes(listing.item);
    const target = isFactoryProduct ? 'products' : 'crops';
    state[target] = state[target] || {};
    state[target][listing.item] = (state[target][listing.item]||0) + listing.qty;
    db.prepare('UPDATE game_state SET state_json = ?, updated_at = ? WHERE user_id = ?')
      .run(JSON.stringify(state), Date.now(), req.user.id);
  }
  db.prepare(`UPDATE market_listings SET status = 'cancelled' WHERE id = ?`).run(listingId);
  recordTx(req.user.id, 'cancel', 0, listing.item, listing.qty, 'إلغاء عرض');
  io.emit('market:update', { type:'cancelled', listingId });
  res.json({ ok: true });
});

// ======================== المحفظة ========================
app.get('/api/wallet', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT msdk FROM users WHERE id = ?').get(req.user.id);
  const history = db.prepare(`SELECT * FROM transactions WHERE user_id = ? ORDER BY time DESC LIMIT 50`)
                    .all(req.user.id);
  res.json({ balance: user.msdk, history });
});

// شحن MSDK - في وضع التطوير، يقبل أي مبلغ. للنشر يجب الربط بـ Stripe / Web3.
app.post('/api/wallet/deposit', authMiddleware, (req, res) => {
  const { amount, paymentToken } = req.body || {};
  const amt = parseInt(amount, 10);
  if (!amt || amt <= 0 || amt > 10_000_000) return res.status(400).json({ error: 'مبلغ غير صحيح' });

  // ⚠️ في الإنتاج: تحقق من paymentToken عبر Stripe API أو Web3 (التحقق من معاملة العقد الذكي)
  // مثال على التحقق:
  //   - Stripe: const charge = await stripe.charges.retrieve(paymentToken)
  //   - Web3:   const tx = await provider.getTransaction(paymentToken); تحقق من to/value/from
  if (process.env.NODE_ENV === 'production' && !paymentToken) {
    return res.status(400).json({ error: 'paymentToken مطلوب في وضع الإنتاج' });
  }

  db.prepare('UPDATE users SET msdk = msdk + ? WHERE id = ?').run(amt, req.user.id);
  // حدّث state
  const sr = db.prepare('SELECT state_json FROM game_state WHERE user_id = ?').get(req.user.id);
  if (sr) {
    const st = JSON.parse(sr.state_json);
    st.msdk = (st.msdk||0) + amt;
    db.prepare('UPDATE game_state SET state_json = ? WHERE user_id = ?').run(JSON.stringify(st), req.user.id);
  }
  recordTx(req.user.id, 'deposit', amt, null, null, paymentToken ? 'دفع: '+paymentToken.slice(0,16) : 'وضع تطوير');
  logAdmin(req.user.id, req.user.name, 'إيداع MSDK', amt+'');
  res.json({ ok: true, balance: req.user.msdk + amt });
});

// سحب MSDK
app.post('/api/wallet/withdraw', authMiddleware, (req, res) => {
  const { amount, address } = req.body || {};
  const amt = parseInt(amount, 10);
  if (!amt || amt <= 0) return res.status(400).json({ error: 'مبلغ غير صحيح' });
  if (!address || address.length < 10) return res.status(400).json({ error: 'عنوان السحب مطلوب' });
  const user = db.prepare('SELECT msdk FROM users WHERE id = ?').get(req.user.id);
  if (user.msdk < amt) return res.status(400).json({ error: 'رصيد غير كافٍ' });
  db.prepare('UPDATE users SET msdk = msdk - ? WHERE id = ?').run(amt, req.user.id);
  // حدّث state
  const sr = db.prepare('SELECT state_json FROM game_state WHERE user_id = ?').get(req.user.id);
  if (sr) {
    const st = JSON.parse(sr.state_json);
    st.msdk = (st.msdk||0) - amt;
    db.prepare('UPDATE game_state SET state_json = ? WHERE user_id = ?').run(JSON.stringify(st), req.user.id);
  }
  recordTx(req.user.id, 'withdraw', -amt, null, null, 'إلى: '+address.slice(0,16));
  logAdmin(req.user.id, req.user.name, 'سحب MSDK', amt+' إلى '+address);
  // ⚠️ في الإنتاج: نفّذ التحويل الفعلي عبر Web3 أو Stripe Connect
  res.json({ ok: true, balance: user.msdk - amt, txStatus: 'pending' });
});

// ======================== الإيداع بالكريبتو ========================
// إرجاع عناوين الإيداع وأسعار الصرف
app.get('/api/wallet/deposit-info', authMiddleware, (req, res) => {
  res.json({
    addresses: {
      tron: DEPOSIT_TRX_ADDRESS,
      bsc:  DEPOSIT_BSC_ADDRESS,
    },
    rates: {
      USDT: MSDK_RATE_PER_USDT,
      TRX:  MSDK_RATE_PER_TRX,
      BNB:  MSDK_RATE_PER_BNB,
    },
    networks: [
      { id:'tron-usdt', label:'USDT على Tron (TRC20)', currency:'USDT', addr: DEPOSIT_TRX_ADDRESS, rate: MSDK_RATE_PER_USDT, fee:'~1 TRX (~$0.30)' },
      { id:'tron-trx',  label:'TRX على Tron',         currency:'TRX',  addr: DEPOSIT_TRX_ADDRESS, rate: MSDK_RATE_PER_TRX,  fee:'~1 TRX' },
      { id:'bsc-bnb',   label:'BNB على BSC',          currency:'BNB',  addr: DEPOSIT_BSC_ADDRESS, rate: MSDK_RATE_PER_BNB,  fee:'~$0.20' },
    ],
  });
});

// تاريخ إيداعاتي الكريبتو
app.get('/api/wallet/crypto-history', authMiddleware, (req, res) => {
  const list = db.prepare(`SELECT * FROM crypto_deposits WHERE user_id = ? ORDER BY created_at DESC LIMIT 30`)
                  .all(req.user.id);
  res.json({ deposits: list });
});

// التحقق من معاملة كريبتو وإيداع MSDK
app.post('/api/wallet/crypto-deposit', authMiddleware, async (req, res) => {
  const { network, txHash } = req.body || {};
  if (!network || !txHash) return res.status(400).json({ error: 'الشبكة و tx hash مطلوبان' });

  const cleanHash = String(txHash).trim().replace(/^0x/i, '');

  // تحقق أنها لم تستخدم من قبل
  const exists = db.prepare('SELECT id, user_id FROM crypto_deposits WHERE tx_hash = ?').get(cleanHash);
  if (exists) {
    return res.status(409).json({ error: 'هذه المعاملة تم استخدامها من قبل' });
  }

  try {
    let verified = null;
    if (network === 'tron-usdt' || network === 'tron-trx') {
      verified = await verifyTronTx(cleanHash, DEPOSIT_TRX_ADDRESS, network === 'tron-usdt' ? 'USDT' : 'TRX');
    } else if (network === 'bsc-bnb') {
      verified = await verifyBscTx(cleanHash, DEPOSIT_BSC_ADDRESS);
    } else {
      return res.status(400).json({ error: 'شبكة غير مدعومة' });
    }

    if (!verified.success) {
      return res.status(400).json({ error: verified.error || 'فشل التحقق من المعاملة' });
    }

    const { currency, amount, fromAddress } = verified;
    const rates = { USDT: MSDK_RATE_PER_USDT, TRX: MSDK_RATE_PER_TRX, BNB: MSDK_RATE_PER_BNB };
    const rate = rates[currency] || 0;
    if (rate === 0) return res.status(400).json({ error: 'عملة غير مدعومة' });

    const msdkAmount = Math.floor(amount * rate);
    if (msdkAmount <= 0) return res.status(400).json({ error: 'المبلغ صغير جداً' });

    // إضافة الرصيد + تسجيل المعاملة
    const tx = db.transaction(() => {
      db.prepare('UPDATE users SET msdk = msdk + ? WHERE id = ?').run(msdkAmount, req.user.id);
      db.prepare(`INSERT INTO crypto_deposits
        (user_id, network, currency, tx_hash, from_address, amount_crypto, amount_msdk, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(req.user.id, network, currency, cleanHash, fromAddress||'', amount, msdkAmount, Date.now());

      // تحديث game_state
      const sr = db.prepare('SELECT state_json FROM game_state WHERE user_id = ?').get(req.user.id);
      if (sr) {
        const st = JSON.parse(sr.state_json);
        st.msdk = (st.msdk || 0) + msdkAmount;
        db.prepare('UPDATE game_state SET state_json = ? WHERE user_id = ?')
          .run(JSON.stringify(st), req.user.id);
      }
    });
    tx();

    recordTx(req.user.id, 'crypto_deposit', msdkAmount, currency, null,
             `${amount} ${currency} → ${msdkAmount} MSDK`, cleanHash.slice(0,16)+'...');
    logAdmin(req.user.id, req.user.name, 'إيداع كريبتو',
             `${amount} ${currency} = ${msdkAmount} MSDK · ${network}`);

    res.json({ ok: true, msdkAmount, currency, amount, txHash: cleanHash });
  } catch (e) {
    console.error('crypto-deposit error:', e);
    res.status(500).json({ error: 'خطأ داخلي: ' + e.message });
  }
});

// التحقق من معاملة Tron عبر tronscan public API
async function verifyTronTx(txHash, expectedAddress, expectedCurrency) {
  if (!expectedAddress) return { success:false, error: 'عنوان الإيداع Tron غير مكوّن. اطلب من الأدمن إضافة DEPOSIT_TRX_ADDRESS' };

  const url = `https://apilist.tronscanapi.com/api/transaction-info?hash=${txHash}`;
  let resp;
  try { resp = await fetch(url, { headers: { 'Accept': 'application/json' } }); }
  catch (e) { return { success:false, error: 'فشل الاتصال بـ tronscan: ' + e.message }; }

  if (!resp.ok) return { success:false, error: 'tronscan رد بـ ' + resp.status };
  const data = await resp.json();

  if (!data || data.contractRet !== 'SUCCESS') {
    return { success:false, error: 'المعاملة لم تنجح على البلوكشين' };
  }

  // 1) USDT TRC20 transfer
  if (expectedCurrency === 'USDT') {
    const transfer = data.trc20TransferInfo && data.trc20TransferInfo[0];
    if (!transfer) return { success:false, error: 'لم يُعثر على تحويل TRC20 في هذه المعاملة' };
    if (transfer.contract_address !== USDT_TRC20_CONTRACT) {
      return { success:false, error: 'العقد ليس USDT - تأكد أنك أرسلت USDT الرسمي' };
    }
    if (transfer.to_address !== expectedAddress) {
      return { success:false, error: 'العنوان المستلم لا يطابق عنواننا. أرسلت إلى: ' + transfer.to_address };
    }
    const amount = parseInt(transfer.amount_str || transfer.quant, 10) / 1e6; // USDT 6 decimals
    return { success:true, currency:'USDT', amount, fromAddress: transfer.from_address };
  }

  // 2) Native TRX
  if (expectedCurrency === 'TRX') {
    const cd = data.contractData || {};
    if (cd.to_address !== expectedAddress) {
      return { success:false, error: 'العنوان المستلم لا يطابق' };
    }
    const amount = (cd.amount || 0) / 1e6;
    return { success:true, currency:'TRX', amount, fromAddress: cd.owner_address };
  }

  return { success:false, error: 'نوع المعاملة غير مدعوم' };
}

// التحقق من معاملة BSC
async function verifyBscTx(txHash, expectedAddress) {
  if (!expectedAddress) return { success:false, error: 'عنوان الإيداع BSC غير مكوّن. اطلب من الأدمن إضافة DEPOSIT_BSC_ADDRESS' };

  const url = `https://api.bscscan.com/api?module=proxy&action=eth_getTransactionByHash&txhash=0x${txHash}`;
  let resp;
  try { resp = await fetch(url, { headers: { 'Accept': 'application/json' } }); }
  catch (e) { return { success:false, error: 'فشل الاتصال بـ bscscan: ' + e.message }; }

  if (!resp.ok) return { success:false, error: 'bscscan رد بـ ' + resp.status };
  const data = await resp.json();
  if (!data.result) return { success:false, error: 'المعاملة غير موجودة بعد. انتظر دقيقة وحاول' };

  const tx = data.result;
  if (!tx.to || tx.to.toLowerCase() !== expectedAddress.toLowerCase()) {
    return { success:false, error: 'العنوان المستلم لا يطابق' };
  }
  const amount = parseInt(tx.value, 16) / 1e18;
  if (amount <= 0) return { success:false, error: 'مبلغ المعاملة صفر' };
  return { success:true, currency:'BNB', amount, fromAddress: tx.from };
}

// ======================== الدردشة ========================
app.get('/api/chat/recent', authMiddleware, (req, res) => {
  const messages = db.prepare(`SELECT * FROM chat_messages ORDER BY time DESC LIMIT 50`).all();
  res.json({ messages: messages.reverse() });
});

// ======================== الأدمن ========================
app.get('/api/admin/players', authMiddleware, adminOnly, (req, res) => {
  const players = db.prepare(`SELECT id, name, type, created_at, last_seen, msdk, xp, level FROM users
                              ORDER BY last_seen DESC LIMIT 200`).all();
  res.json({ players });
});

app.get('/api/admin/transactions', authMiddleware, adminOnly, (req, res) => {
  const txs = db.prepare(`SELECT t.*, u.name as user_name FROM transactions t
                          LEFT JOIN users u ON t.user_id = u.id
                          ORDER BY time DESC LIMIT 100`).all();
  res.json({ transactions: txs });
});

app.get('/api/admin/stats', authMiddleware, adminOnly, (req, res) => {
  const totalPlayers = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  const onlinePlayers = db.prepare('SELECT COUNT(*) as c FROM users WHERE last_seen > ?')
                          .get(Date.now() - 5*60*1000).c;
  const totalMSDK = db.prepare('SELECT SUM(msdk) as s FROM users').get().s || 0;
  const activeListings = db.prepare(`SELECT COUNT(*) as c FROM market_listings WHERE status='active' AND expires_at > ?`)
                           .get(Date.now()).c;
  const recentDeposits = db.prepare(`SELECT SUM(amount) as s FROM transactions WHERE type='deposit' AND time > ?`)
                            .get(Date.now() - 24*60*60*1000).s || 0;
  const recentWithdrawals = db.prepare(`SELECT SUM(ABS(amount)) as s FROM transactions WHERE type='withdraw' AND time > ?`)
                               .get(Date.now() - 24*60*60*1000).s || 0;
  res.json({
    totalPlayers, onlinePlayers, totalMSDK,
    activeListings, recentDeposits, recentWithdrawals,
  });
});

app.get('/api/admin/log', authMiddleware, adminOnly, (req, res) => {
  const log = db.prepare(`SELECT * FROM admin_log ORDER BY time DESC LIMIT 200`).all();
  res.json({ log });
});

// تعديل رصيد لاعب (أدمن فقط)
app.post('/api/admin/adjust', authMiddleware, adminOnly, (req, res) => {
  const { userId, amount, reason } = req.body || {};
  const amt = parseInt(amount, 10);
  if (!userId || isNaN(amt)) return res.status(400).json({ error: 'بيانات غير صحيحة' });
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!target) return res.status(404).json({ error: 'مستخدم غير موجود' });
  db.prepare('UPDATE users SET msdk = msdk + ? WHERE id = ?').run(amt, userId);
  // حدّث state
  const sr = db.prepare('SELECT state_json FROM game_state WHERE user_id = ?').get(userId);
  if (sr) {
    const st = JSON.parse(sr.state_json);
    st.msdk = (st.msdk||0) + amt;
    db.prepare('UPDATE game_state SET state_json = ? WHERE user_id = ?').run(JSON.stringify(st), userId);
  }
  recordTx(userId, 'admin_adjust', amt, null, null, reason || 'تعديل أدمن: '+req.user.name);
  logAdmin(req.user.id, req.user.name, 'تعديل رصيد', `لـ ${target.name}: ${amt} (${reason||''})`);
  res.json({ ok: true });
});

// ======================== Socket.IO - الدردشة ========================
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('غير مصرح'));
  try {
    const user = jwt.verify(token, JWT_SECRET);
    socket.user = user;
    next();
  } catch(e) { next(new Error('token غير صحيح')); }
});

io.on('connection', (socket) => {
  console.log(`🔌 ${socket.user.name} (#${socket.user.id}) متصل`);
  socket.join('user:'+socket.user.id);
  socket.join('global');

  // أعلم الآخرين
  io.to('global').emit('presence', { type:'join', name: socket.user.name });

  // الدردشة
  socket.on('chat:send', (data) => {
    const text = (data?.text || '').trim().slice(0, 300);
    if (!text) return;
    const msg = {
      user_id: socket.user.id,
      user_name: socket.user.name,
      text,
      time: Date.now(),
    };
    db.prepare(`INSERT INTO chat_messages (user_id, user_name, text, time) VALUES (?, ?, ?, ?)`)
      .run(msg.user_id, msg.user_name, msg.text, msg.time);
    io.to('global').emit('chat:msg', msg);
  });

  socket.on('disconnect', () => {
    io.to('global').emit('presence', { type:'leave', name: socket.user.name });
  });
});

// ======================== الواجهة (Static) ========================
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'not found' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ======================== تشغيل ========================
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚜 MSDK Farm Backend جاهز على المنفذ ${PORT}`);
  console.log(`📊 قاعدة البيانات: ${DB_PATH}`);
  console.log(`🔐 الأدمن: admin / ${ADMIN_PASSWORD}`);
  console.log(`💡 الرابط المحلي: http://localhost:${PORT}`);
});

// تنظيف العروض المنتهية كل دقيقة
setInterval(() => {
  const result = db.prepare(`UPDATE market_listings SET status='expired' WHERE status='active' AND expires_at < ?`)
                    .run(Date.now());
  if (result.changes > 0) {
    io.emit('market:update', { type:'cleanup', count: result.changes });
  }
}, 60_000);
