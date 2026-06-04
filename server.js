/**
 * MSDK Farm - Full-Stack Backend
 * Express + Socket.IO + better-sqlite3
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
const Database = require('better-sqlite3');

// ============== الإعدادات ==============
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || ('msdk-' + Math.random().toString(36).slice(2));
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

const DB_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.DB_DIR || __dirname;
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
const DB_PATH = path.join(DB_DIR, 'msdk.db');
console.log('DB path:', DB_PATH);

const db = new Database(DB_PATH);
try { db.pragma('journal_mode = WAL'); } catch (e) { console.warn('pragma warn:', e.message); }

// ============== الجداول ==============
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
    updated_at INTEGER NOT NULL
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
    status TEXT DEFAULT 'active'
  );
  CREATE INDEX IF NOT EXISTS idx_market_status ON market_listings(status);
  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    amount INTEGER NOT NULL,
    item TEXT,
    qty INTEGER,
    note TEXT,
    counterparty TEXT,
    time INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    user_name TEXT NOT NULL,
    text TEXT NOT NULL,
    time INTEGER NOT NULL
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
    created_at INTEGER NOT NULL
  );
`);

// أنشئ admin
try {
  const adminRow = db.prepare("SELECT id FROM users WHERE name = 'admin'").get();
  if (!adminRow) {
    const hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
    const now = Date.now();
    db.prepare(`INSERT INTO users (name, password_hash, type, created_at, last_seen, msdk)
                VALUES (?, ?, 'admin', ?, ?, 100000)`).run('admin', hash, now, now);
    console.log('Admin user created (password env or admin123)');
  }
} catch (e) { console.error('admin create err:', e); }

// ============== كريبتو ==============
const DEPOSIT_TRX_ADDRESS = process.env.DEPOSIT_TRX_ADDRESS || '';
const DEPOSIT_BSC_ADDRESS = process.env.DEPOSIT_BSC_ADDRESS || '';
const MSDK_RATE_PER_USDT = parseInt(process.env.MSDK_RATE_PER_USDT || '1000', 10);
const MSDK_RATE_PER_TRX  = parseInt(process.env.MSDK_RATE_PER_TRX  || '100',  10);
const MSDK_RATE_PER_BNB  = parseInt(process.env.MSDK_RATE_PER_BNB  || '500000', 10);
const USDT_TRC20_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

// ============== Express + Socket.IO ==============
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(compression());
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const authLim = rateLimit({ windowMs: 60_000, max: 20 });
const apiLim  = rateLimit({ windowMs: 60_000, max: 300 });
app.use('/api/auth/', authLim);
app.use('/api/', apiLim);

// ============== مساعدات ==============
function makeToken(u){
  return jwt.sign({ id:u.id, name:u.name, type:u.type }, JWT_SECRET, { expiresIn:'30d' });
}
function auth(req, res, next){
  const t = (req.headers.authorization || '').replace(/^Bearer\s+/, '');
  if (!t) return res.status(401).json({ error: 'no token' });
  try {
    const dec = jwt.verify(t, JWT_SECRET);
    const u = db.prepare('SELECT id, name, type, msdk, xp, level FROM users WHERE id = ?').get(dec.id);
    if (!u) return res.status(401).json({ error: 'no user' });
    req.user = u;
    db.prepare('UPDATE users SET last_seen=? WHERE id=?').run(Date.now(), u.id);
    next();
  } catch(e){ return res.status(401).json({ error: 'bad token' }); }
}
function adminOnly(req, res, next){
  if (req.user?.type !== 'admin') return res.status(403).json({ error: 'admin only' });
  next();
}
function logAdmin(uid, name, action, details=''){
  db.prepare('INSERT INTO admin_log (user_id, user_name, action, details, time) VALUES (?,?,?,?,?)')
    .run(uid, name, action, details, Date.now());
}
function recordTx(uid, type, amount, item=null, qty=null, note='', cp=''){
  db.prepare(`INSERT INTO transactions (user_id, type, amount, item, qty, note, counterparty, time)
              VALUES (?,?,?,?,?,?,?,?)`)
    .run(uid, type, amount, item, qty, note, cp, Date.now());
}

// ============== Auth ==============
app.post('/api/auth/register', (req, res) => {
  const { name, password } = req.body || {};
  if (!name || !password) return res.status(400).json({ error: 'الاسم وكلمة المرور مطلوبان' });
  if (name.length < 2 || name.length > 20) return res.status(400).json({ error: 'الاسم بين 2 و 20 حرف' });
  if (password.length < 4) return res.status(400).json({ error: 'كلمة المرور قصيرة' });
  if (db.prepare('SELECT id FROM users WHERE name = ?').get(name)) {
    return res.status(409).json({ error: 'الاسم محجوز' });
  }
  const hash = bcrypt.hashSync(password, 10);
  const now = Date.now();
  const r = db.prepare(`INSERT INTO users (name, password_hash, created_at, last_seen) VALUES (?,?,?,?)`)
              .run(name, hash, now, now);
  const u = db.prepare('SELECT id, name, type, msdk, xp, level FROM users WHERE id = ?').get(r.lastInsertRowid);
  logAdmin(u.id, name, 'تسجيل', '');
  res.json({ token: makeToken(u), user: u });
});

app.post('/api/auth/login', (req, res) => {
  const { name, password } = req.body || {};
  if (!name || !password) return res.status(400).json({ error: 'بيانات ناقصة' });
  const u = db.prepare('SELECT * FROM users WHERE name = ?').get(name);
  if (!u || !bcrypt.compareSync(password, u.password_hash)) {
    return res.status(401).json({ error: 'بيانات خاطئة' });
  }
  db.prepare('UPDATE users SET last_seen=? WHERE id=?').run(Date.now(), u.id);
  const safe = { id:u.id, name:u.name, type:u.type, msdk:u.msdk, xp:u.xp, level:u.level };
  logAdmin(u.id, u.name, 'تسجيل دخول', '');
  res.json({ token: makeToken(safe), user: safe });
});

app.get('/api/auth/me', auth, (req, res) => res.json({ user: req.user }));

// ============== حالة اللعبة ==============
app.get('/api/game/state', auth, (req, res) => {
  const r = db.prepare('SELECT state_json FROM game_state WHERE user_id=?').get(req.user.id);
  if (!r) return res.json({ state: null });
  try { res.json({ state: JSON.parse(r.state_json) }); }
  catch(e){ res.json({ state: null }); }
});

app.post('/api/game/state', auth, (req, res) => {
  const s = req.body?.state;
  if (!s || typeof s !== 'object') return res.status(400).json({ error: 'state required' });
  const json = JSON.stringify(s);
  if (json.length > 1024*1024) return res.status(413).json({ error: 'state too big' });
  if (typeof s.msdk === 'number') {
    db.prepare('UPDATE users SET msdk=?, xp=?, level=? WHERE id=?')
      .run(s.msdk|0, s.xp|0, s.level|1, req.user.id);
  }
  db.prepare(`INSERT INTO game_state (user_id, state_json, updated_at) VALUES (?,?,?)
              ON CONFLICT(user_id) DO UPDATE SET state_json=excluded.state_json, updated_at=excluded.updated_at`)
    .run(req.user.id, json, Date.now());
  res.json({ ok: true });
});

// ============== السوق ==============
app.get('/api/market', auth, (req, res) => {
  const { item, sort = 'priceAsc' } = req.query;
  let q = `SELECT id, seller_id, seller_name, item, qty, price, created_at, expires_at
           FROM market_listings WHERE status='active' AND expires_at > ?`;
  const p = [Date.now()];
  if (item && item !== 'all') { q += ' AND item=?'; p.push(item); }
  if (sort === 'priceAsc')  q += ' ORDER BY price ASC';
  else if (sort === 'priceDesc') q += ' ORDER BY price DESC';
  else if (sort === 'qtyDesc')   q += ' ORDER BY qty DESC';
  else if (sort === 'qtyAsc')    q += ' ORDER BY qty ASC';
  else q += ' ORDER BY created_at DESC';
  q += ' LIMIT 200';
  res.json({ listings: db.prepare(q).all(...p) });
});

app.get('/api/market/stats', auth, (req, res) => {
  const stats = db.prepare(`SELECT item, COUNT(*) AS listings, SUM(qty) AS total_qty,
                            MIN(price) AS min_price, MAX(price) AS max_price, AVG(price) AS avg_price
                            FROM market_listings WHERE status='active' AND expires_at>?
                            GROUP BY item`).all(Date.now());
  res.json({ stats });
});

app.get('/api/market/mine', auth, (req, res) => {
  res.json({ listings: db.prepare(`SELECT * FROM market_listings WHERE seller_id=? AND status IN ('active','sold')
                                   ORDER BY created_at DESC LIMIT 100`).all(req.user.id) });
});

const FACTORY_PRODUCTS = ['flour','cornmeal','bread','cake','cheese','butter','yogurt','fabric','sweater','juice','jam','wine'];

app.post('/api/market/list', auth, (req, res) => {
  const { item, qty, price } = req.body || {};
  if (!item || !qty || !price) return res.status(400).json({ error: 'بيانات ناقصة' });
  if (qty <= 0 || price <= 0) return res.status(400).json({ error: 'قيم غير صالحة' });
  if (qty > 999 || price > 1_000_000_000) return res.status(400).json({ error: 'قيم خارج النطاق' });
  const row = db.prepare('SELECT state_json FROM game_state WHERE user_id=?').get(req.user.id);
  if (!row) return res.status(400).json({ error: 'احفظ حالة اللعبة أولاً' });
  const s = JSON.parse(row.state_json);
  const inv = { ...(s.crops||{}), ...(s.products||{}) };
  if ((inv[item]||0) < qty) return res.status(400).json({ error: 'لا تملك هذه الكمية' });
  if ((s.crops||{})[item] >= qty) {
    s.crops[item] -= qty;
    if (s.crops[item] <= 0) delete s.crops[item];
  } else if ((s.products||{})[item] >= qty) {
    s.products[item] -= qty;
    if (s.products[item] <= 0) delete s.products[item];
  }
  db.prepare('UPDATE game_state SET state_json=?, updated_at=? WHERE user_id=?')
    .run(JSON.stringify(s), Date.now(), req.user.id);
  const r = db.prepare(`INSERT INTO market_listings
    (seller_id, seller_name, item, qty, price, created_at, expires_at, status)
    VALUES (?,?,?,?,?,?,?,'active')`)
    .run(req.user.id, req.user.name, item, qty, price, Date.now(), Date.now() + 24*3600*1000);
  recordTx(req.user.id, 'list', 0, item, qty, `price: ${price}`);
  io.emit('market:update', { type:'new', listingId: r.lastInsertRowid });
  res.json({ ok: true, listingId: r.lastInsertRowid });
});

app.post('/api/market/buy/:id', auth, (req, res) => {
  const lid = parseInt(req.params.id, 10);
  try {
    const tx = db.transaction(() => {
      const L = db.prepare(`SELECT * FROM market_listings WHERE id=? AND status='active'`).get(lid);
      if (!L) throw new Error('العرض غير موجود');
      if (L.expires_at < Date.now()) throw new Error('العرض منتهي');
      if (L.seller_id === req.user.id) throw new Error('لا يمكنك شراء عرضك');
      const total = L.price * L.qty;
      const buyer = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
      if (buyer.msdk < total) throw new Error('رصيد غير كاف');
      db.prepare('UPDATE users SET msdk=msdk-? WHERE id=?').run(total, req.user.id);
      db.prepare('UPDATE users SET msdk=msdk+? WHERE id=?').run(total, L.seller_id);
      db.prepare(`UPDATE market_listings SET status='sold' WHERE id=?`).run(lid);
      const isFP = FACTORY_PRODUCTS.includes(L.item);
      const target = isFP ? 'products' : 'crops';
      const bsr = db.prepare('SELECT state_json FROM game_state WHERE user_id=?').get(req.user.id);
      if (bsr) {
        const bs = JSON.parse(bsr.state_json);
        bs[target] = bs[target] || {};
        bs[target][L.item] = (bs[target][L.item]||0) + L.qty;
        bs.msdk = (bs.msdk||0) - total;
        db.prepare('UPDATE game_state SET state_json=?, updated_at=? WHERE user_id=?')
          .run(JSON.stringify(bs), Date.now(), req.user.id);
      }
      const ssr = db.prepare('SELECT state_json FROM game_state WHERE user_id=?').get(L.seller_id);
      if (ssr) {
        const ss = JSON.parse(ssr.state_json);
        ss.msdk = (ss.msdk||0) + total;
        db.prepare('UPDATE game_state SET state_json=?, updated_at=? WHERE user_id=?')
          .run(JSON.stringify(ss), Date.now(), L.seller_id);
      }
      recordTx(req.user.id, 'buy', -total, L.item, L.qty, '', L.seller_name);
      recordTx(L.seller_id, 'sell', total, L.item, L.qty, '', req.user.name);
      return { L, total };
    });
    const { L, total } = tx();
    io.emit('market:update', { type:'sold', listingId: lid });
    io.to('user:'+L.seller_id).emit('notify', {
      type:'sale', msg:`💰 بيعت سلعتك (${L.qty}× ${L.item}) بـ ${total} MSDK`
    });
    res.json({ ok: true, total });
  } catch(e){ res.status(400).json({ error: e.message }); }
});

app.post('/api/market/cancel/:id', auth, (req, res) => {
  const lid = parseInt(req.params.id, 10);
  const L = db.prepare(`SELECT * FROM market_listings WHERE id=? AND status='active' AND seller_id=?`)
              .get(lid, req.user.id);
  if (!L) return res.status(404).json({ error: 'العرض غير موجود' });
  const sr = db.prepare('SELECT state_json FROM game_state WHERE user_id=?').get(req.user.id);
  if (sr) {
    const s = JSON.parse(sr.state_json);
    const isFP = FACTORY_PRODUCTS.includes(L.item);
    const tg = isFP ? 'products' : 'crops';
    s[tg] = s[tg] || {};
    s[tg][L.item] = (s[tg][L.item]||0) + L.qty;
    db.prepare('UPDATE game_state SET state_json=?, updated_at=? WHERE user_id=?')
      .run(JSON.stringify(s), Date.now(), req.user.id);
  }
  db.prepare(`UPDATE market_listings SET status='cancelled' WHERE id=?`).run(lid);
  recordTx(req.user.id, 'cancel', 0, L.item, L.qty, 'إلغاء عرض');
  io.emit('market:update', { type:'cancelled', listingId: lid });
  res.json({ ok: true });
});

// ============== المحفظة ==============
app.get('/api/wallet', auth, (req, res) => {
  const u = db.prepare('SELECT msdk FROM users WHERE id=?').get(req.user.id);
  const history = db.prepare(`SELECT * FROM transactions WHERE user_id=? ORDER BY time DESC LIMIT 50`).all(req.user.id);
  res.json({ balance: u.msdk, history });
});

app.post('/api/wallet/deposit', auth, (req, res) => {
  const amt = parseInt(req.body?.amount, 10);
  if (!amt || amt <= 0 || amt > 10_000_000) return res.status(400).json({ error: 'مبلغ غير صحيح' });
  db.prepare('UPDATE users SET msdk=msdk+? WHERE id=?').run(amt, req.user.id);
  const sr = db.prepare('SELECT state_json FROM game_state WHERE user_id=?').get(req.user.id);
  if (sr) {
    const st = JSON.parse(sr.state_json);
    st.msdk = (st.msdk||0) + amt;
    db.prepare('UPDATE game_state SET state_json=? WHERE user_id=?').run(JSON.stringify(st), req.user.id);
  }
  recordTx(req.user.id, 'deposit', amt, null, null, 'إيداع (تطوير)');
  logAdmin(req.user.id, req.user.name, 'إيداع', String(amt));
  res.json({ ok: true, balance: req.user.msdk + amt });
});

app.post('/api/wallet/withdraw', auth, (req, res) => {
  const amt = parseInt(req.body?.amount, 10);
  const addr = req.body?.address || '';
  if (!amt || amt <= 0) return res.status(400).json({ error: 'مبلغ غير صحيح' });
  if (addr.length < 10) return res.status(400).json({ error: 'عنوان السحب مطلوب' });
  const u = db.prepare('SELECT msdk FROM users WHERE id=?').get(req.user.id);
  if (u.msdk < amt) return res.status(400).json({ error: 'رصيد غير كاف' });
  db.prepare('UPDATE users SET msdk=msdk-? WHERE id=?').run(amt, req.user.id);
  const sr = db.prepare('SELECT state_json FROM game_state WHERE user_id=?').get(req.user.id);
  if (sr) {
    const st = JSON.parse(sr.state_json);
    st.msdk = (st.msdk||0) - amt;
    db.prepare('UPDATE game_state SET state_json=? WHERE user_id=?').run(JSON.stringify(st), req.user.id);
  }
  recordTx(req.user.id, 'withdraw', -amt, null, null, 'سحب إلى ' + addr.slice(0,16));
  logAdmin(req.user.id, req.user.name, 'سحب', amt + ' to ' + addr);
  res.json({ ok: true, balance: u.msdk - amt, txStatus: 'pending' });
});

// ============== كريبتو ==============
app.get('/api/wallet/deposit-info', auth, (req, res) => {
  res.json({
    addresses: { tron: DEPOSIT_TRX_ADDRESS, bsc: DEPOSIT_BSC_ADDRESS },
    rates: { USDT: MSDK_RATE_PER_USDT, TRX: MSDK_RATE_PER_TRX, BNB: MSDK_RATE_PER_BNB },
    networks: [
      { id:'tron-usdt', label:'USDT على Tron (TRC20)', currency:'USDT', addr: DEPOSIT_TRX_ADDRESS, rate: MSDK_RATE_PER_USDT, fee:'~1 TRX' },
      { id:'tron-trx',  label:'TRX على Tron',         currency:'TRX',  addr: DEPOSIT_TRX_ADDRESS, rate: MSDK_RATE_PER_TRX,  fee:'~1 TRX' },
      { id:'bsc-bnb',   label:'BNB على BSC',          currency:'BNB',  addr: DEPOSIT_BSC_ADDRESS, rate: MSDK_RATE_PER_BNB,  fee:'~$0.20' },
    ],
  });
});

app.get('/api/wallet/crypto-history', auth, (req, res) => {
  res.json({ deposits: db.prepare(`SELECT * FROM crypto_deposits WHERE user_id=? ORDER BY created_at DESC LIMIT 30`).all(req.user.id) });
});

app.post('/api/wallet/crypto-deposit', auth, async (req, res) => {
  const { network, txHash } = req.body || {};
  if (!network || !txHash) return res.status(400).json({ error: 'الشبكة و tx hash مطلوبان' });
  const clean = String(txHash).trim().replace(/^0x/i, '');
  if (db.prepare('SELECT id FROM crypto_deposits WHERE tx_hash=?').get(clean)) {
    return res.status(409).json({ error: 'هذه المعاملة استخدمت من قبل' });
  }
  try {
    let v = null;
    if (network === 'tron-usdt' || network === 'tron-trx') {
      v = await verifyTron(clean, DEPOSIT_TRX_ADDRESS, network === 'tron-usdt' ? 'USDT' : 'TRX');
    } else if (network === 'bsc-bnb') {
      v = await verifyBsc(clean, DEPOSIT_BSC_ADDRESS);
    } else { return res.status(400).json({ error: 'شبكة غير مدعومة' }); }
    if (!v.success) return res.status(400).json({ error: v.error || 'فشل التحقق' });

    const { currency, amount, fromAddress } = v;
    const rates = { USDT: MSDK_RATE_PER_USDT, TRX: MSDK_RATE_PER_TRX, BNB: MSDK_RATE_PER_BNB };
    const rate = rates[currency] || 0;
    if (!rate) return res.status(400).json({ error: 'عملة غير مدعومة' });
    const msdkAmt = Math.floor(amount * rate);
    if (msdkAmt <= 0) return res.status(400).json({ error: 'المبلغ صغير جداً' });

    const tx = db.transaction(() => {
      db.prepare('UPDATE users SET msdk=msdk+? WHERE id=?').run(msdkAmt, req.user.id);
      db.prepare(`INSERT INTO crypto_deposits (user_id, network, currency, tx_hash, from_address, amount_crypto, amount_msdk, created_at)
                  VALUES (?,?,?,?,?,?,?,?)`)
        .run(req.user.id, network, currency, clean, fromAddress||'', amount, msdkAmt, Date.now());
      const sr = db.prepare('SELECT state_json FROM game_state WHERE user_id=?').get(req.user.id);
      if (sr) {
        const st = JSON.parse(sr.state_json);
        st.msdk = (st.msdk||0) + msdkAmt;
        db.prepare('UPDATE game_state SET state_json=? WHERE user_id=?').run(JSON.stringify(st), req.user.id);
      }
    });
    tx();
    recordTx(req.user.id, 'crypto_deposit', msdkAmt, currency, null, `${amount} ${currency} → ${msdkAmt} MSDK`, clean.slice(0,16));
    logAdmin(req.user.id, req.user.name, 'إيداع كريبتو', `${amount} ${currency} = ${msdkAmt} MSDK`);
    res.json({ ok: true, msdkAmount: msdkAmt, currency, amount });
  } catch(e){
    console.error('crypto err:', e);
    res.status(500).json({ error: e.message });
  }
});

async function verifyTron(hash, expected, expCur) {
  if (!expected) return { success:false, error: 'عنوان TRX غير مكون' };
  try {
    const r = await fetch(`https://apilist.tronscanapi.com/api/transaction-info?hash=${hash}`);
    if (!r.ok) return { success:false, error: 'tronscan ' + r.status };
    const d = await r.json();
    if (!d || d.contractRet !== 'SUCCESS') return { success:false, error: 'المعاملة لم تنجح' };
    if (expCur === 'USDT') {
      const t = d.trc20TransferInfo && d.trc20TransferInfo[0];
      if (!t) return { success:false, error: 'لا تحويل TRC20' };
      if (t.contract_address !== USDT_TRC20_CONTRACT) return { success:false, error: 'ليس USDT الرسمي' };
      if (t.to_address !== expected) return { success:false, error: 'العنوان لا يطابق' };
      const amt = parseInt(t.amount_str || t.quant, 10) / 1e6;
      return { success:true, currency:'USDT', amount: amt, fromAddress: t.from_address };
    }
    if (expCur === 'TRX') {
      const cd = d.contractData || {};
      if (cd.to_address !== expected) return { success:false, error: 'العنوان لا يطابق' };
      const amt = (cd.amount || 0) / 1e6;
      return { success:true, currency:'TRX', amount: amt, fromAddress: cd.owner_address };
    }
    return { success:false, error: 'غير مدعوم' };
  } catch(e){ return { success:false, error: e.message }; }
}

async function verifyBsc(hash, expected) {
  if (!expected) return { success:false, error: 'عنوان BSC غير مكون' };
  try {
    const r = await fetch(`https://api.bscscan.com/api?module=proxy&action=eth_getTransactionByHash&txhash=0x${hash}`);
    if (!r.ok) return { success:false, error: 'bscscan ' + r.status };
    const d = await r.json();
    if (!d.result) return { success:false, error: 'معاملة غير موجودة' };
    const tx = d.result;
    if (!tx.to || tx.to.toLowerCase() !== expected.toLowerCase()) return { success:false, error: 'العنوان لا يطابق' };
    const amt = parseInt(tx.value, 16) / 1e18;
    if (amt <= 0) return { success:false, error: 'مبلغ صفر' };
    return { success:true, currency:'BNB', amount: amt, fromAddress: tx.from };
  } catch(e){ return { success:false, error: e.message }; }
}

// ============== الدردشة ==============
app.get('/api/chat/recent', auth, (req, res) => {
  res.json({ messages: db.prepare(`SELECT * FROM chat_messages ORDER BY time DESC LIMIT 50`).all().reverse() });
});

// ============== الأدمن ==============
app.get('/api/admin/players', auth, adminOnly, (req, res) => {
  res.json({ players: db.prepare(`SELECT id, name, type, created_at, last_seen, msdk, xp, level
                                  FROM users ORDER BY last_seen DESC LIMIT 200`).all() });
});

app.get('/api/admin/transactions', auth, adminOnly, (req, res) => {
  res.json({ transactions: db.prepare(`SELECT t.*, u.name AS user_name FROM transactions t
                                       LEFT JOIN users u ON t.user_id = u.id
                                       ORDER BY time DESC LIMIT 100`).all() });
});

app.get('/api/admin/stats', auth, adminOnly, (req, res) => {
  const totalPlayers = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  const onlinePlayers = db.prepare('SELECT COUNT(*) AS c FROM users WHERE last_seen>?').get(Date.now()-5*60*1000).c;
  const totalMSDK = db.prepare('SELECT SUM(msdk) AS s FROM users').get().s || 0;
  const activeListings = db.prepare(`SELECT COUNT(*) AS c FROM market_listings WHERE status='active' AND expires_at>?`).get(Date.now()).c;
  const recentDeposits = db.prepare(`SELECT SUM(amount) AS s FROM transactions WHERE type='deposit' AND time>?`).get(Date.now()-24*3600*1000).s || 0;
  const recentWithdrawals = db.prepare(`SELECT SUM(ABS(amount)) AS s FROM transactions WHERE type='withdraw' AND time>?`).get(Date.now()-24*3600*1000).s || 0;
  res.json({ totalPlayers, onlinePlayers, totalMSDK, activeListings, recentDeposits, recentWithdrawals });
});

app.get('/api/admin/log', auth, adminOnly, (req, res) => {
  res.json({ log: db.prepare(`SELECT * FROM admin_log ORDER BY time DESC LIMIT 200`).all() });
});

app.post('/api/admin/adjust', auth, adminOnly, (req, res) => {
  const { userId, amount, reason } = req.body || {};
  const amt = parseInt(amount, 10);
  if (!userId || isNaN(amt)) return res.status(400).json({ error: 'بيانات غير صحيحة' });
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(userId);
  if (!u) return res.status(404).json({ error: 'مستخدم غير موجود' });
  db.prepare('UPDATE users SET msdk=msdk+? WHERE id=?').run(amt, userId);
  const sr = db.prepare('SELECT state_json FROM game_state WHERE user_id=?').get(userId);
  if (sr) {
    const st = JSON.parse(sr.state_json);
    st.msdk = (st.msdk||0) + amt;
    db.prepare('UPDATE game_state SET state_json=? WHERE user_id=?').run(JSON.stringify(st), userId);
  }
  recordTx(userId, 'admin_adjust', amt, null, null, reason || 'تعديل أدمن');
  logAdmin(req.user.id, req.user.name, 'تعديل رصيد', `${u.name}: ${amt}`);
  res.json({ ok: true });
});

// ============== Socket.IO ==============
io.use((sock, next) => {
  const t = sock.handshake.auth?.token;
  if (!t) return next(new Error('no token'));
  try {
    sock.user = jwt.verify(t, JWT_SECRET);
    next();
  } catch(e){ next(new Error('bad token')); }
});

io.on('connection', (sock) => {
  console.log('connected:', sock.user.name);
  sock.join('user:'+sock.user.id);
  sock.join('global');
  io.to('global').emit('presence', { type:'join', name: sock.user.name });

  sock.on('chat:send', (data) => {
    const text = (data?.text || '').trim().slice(0, 300);
    if (!text) return;
    const msg = { user_id: sock.user.id, user_name: sock.user.name, text, time: Date.now() };
    db.prepare(`INSERT INTO chat_messages (user_id, user_name, text, time) VALUES (?,?,?,?)`)
      .run(msg.user_id, msg.user_name, msg.text, msg.time);
    io.to('global').emit('chat:msg', msg);
  });

  sock.on('disconnect', () => {
    io.to('global').emit('presence', { type:'leave', name: sock.user.name });
  });
});

// ============== Static ==============
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'not found' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============== تنظيف ==============
setInterval(() => {
  const r = db.prepare(`UPDATE market_listings SET status='expired' WHERE status='active' AND expires_at<?`).run(Date.now());
  if (r.changes > 0) io.emit('market:update', { type:'cleanup', count: r.changes });
}, 60_000);

// ============== تشغيل ==============
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚜 MSDK Farm running on port ${PORT}`);
});
