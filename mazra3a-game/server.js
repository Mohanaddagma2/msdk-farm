const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const url = require('url');
const querystring = require('querystring');

// ======================== CONFIG ========================
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'gamedata.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const ADMIN_USERNAME = 'MSDK';
const ADMIN_PASSWORD_HASH = crypto.createHash('sha256').update('Mohanad1!').digest('hex');

// Game Constants
const CROPS = [
  { id: 'onion', name: 'بصل', growTime: 6 * 3600 * 1000, cost: 8, baseValue: 18, xp: 5 },
  { id: 'tomato', name: 'طماطم', growTime: 8 * 3600 * 1000, cost: 20, baseValue: 35, xp: 8 },
  { id: 'corn', name: 'ذرة', growTime: 12 * 3600 * 1000, cost: 15, baseValue: 30, xp: 10 },
  { id: 'potato', name: 'بطاطس', growTime: 16 * 3600 * 1000, cost: 12, baseValue: 25, xp: 7 },
  { id: 'wheat', name: 'قمح', growTime: 24 * 3600 * 1000, cost: 10, baseValue: 22, xp: 12 },
  { id: 'cotton', name: 'قطن', growTime: 48 * 3600 * 1000, cost: 30, baseValue: 80, xp: 25 },
  { id: 'olive', name: 'زيتون', growTime: 120 * 3600 * 1000, cost: 40, baseValue: 150, xp: 50 },
  { id: 'grape', name: 'عنب', growTime: 168 * 3600 * 1000, cost: 50, baseValue: 200, xp: 75 },
];

const ANIMALS = [
  { id: 'chicken', name: 'دجاج', cost: 200, prodTime: 4 * 3600 * 1000, product: 'بيض', prodValue: 15, xp: 8, unlockLevel: 5, penId: 'chicken_pen' },
  { id: 'sheep', name: 'خروف', cost: 800, prodTime: 12 * 3600 * 1000, product: 'صوف', prodValue: 50, xp: 20, unlockLevel: 10, penId: 'sheep_pen' },
  { id: 'goat', name: 'ماعز', cost: 1000, prodTime: 8 * 3600 * 1000, product: 'حليب_ماعز', prodValue: 40, xp: 15, unlockLevel: 15, penId: 'goat_pen' },
  { id: 'cow', name: 'بقرة', cost: 3000, prodTime: 6 * 3600 * 1000, product: 'حليب', prodValue: 60, xp: 25, unlockLevel: 20, penId: 'cow_pen' },
  { id: 'bee', name: 'نحل', cost: 1500, prodTime: 24 * 3600 * 1000, product: 'عسل', prodValue: 100, xp: 40, unlockLevel: 25, penId: 'bee_pen' },
  { id: 'horse', name: 'حصان', cost: 8000, prodTime: 48 * 3600 * 1000, product: 'أرباح_سباق', prodValue: 250, xp: 80, unlockLevel: 30, penId: 'horse_pen' },
];

const PENS = [
  { id: 'chicken_pen', name: 'قن دجاج', cost: 500, capacity: 4, unlockLevel: 5, animalId: 'chicken', upgradeCost: 400 },
  { id: 'sheep_pen', name: 'حظيرة أغنام', cost: 1500, capacity: 3, unlockLevel: 10, animalId: 'sheep', upgradeCost: 1200 },
  { id: 'goat_pen', name: 'حظيرة ماعز', cost: 2000, capacity: 3, unlockLevel: 15, animalId: 'goat', upgradeCost: 1500 },
  { id: 'cow_pen', name: 'حظيرة أبقار', cost: 5000, capacity: 2, unlockLevel: 20, animalId: 'cow', upgradeCost: 4000 },
  { id: 'bee_pen', name: 'خلية نحل', cost: 3000, capacity: 5, unlockLevel: 25, animalId: 'bee', upgradeCost: 2500 },
  { id: 'horse_pen', name: 'إسطبل', cost: 10000, capacity: 2, unlockLevel: 30, animalId: 'horse', upgradeCost: 8000 },
];

const FACTORIES = [
  { id: 'mill', name: 'طاحونة', desc: 'تحويل القمح إلى طحين', cost: 2000, unlockLevel: 5, input: 'wheat', inputQty: 5, output: 'طحين', outputQty: 3, outputValue: 50, prodTime: 2 * 3600 * 1000, xp: 15 },
  { id: 'bakery', name: 'مخبز', desc: 'تحويل الطحين إلى خبز', cost: 3500, unlockLevel: 8, input: 'طحين', inputQty: 3, output: 'خبز', outputQty: 5, outputValue: 30, prodTime: 1.5 * 3600 * 1000, xp: 12 },
  { id: 'cannery', name: 'مصنع معلبات', desc: 'تعليب الطماطم والذرة', cost: 5000, unlockLevel: 10, input: 'tomato', inputQty: 8, output: 'معلبات', outputQty: 4, outputValue: 80, prodTime: 3 * 3600 * 1000, xp: 20 },
  { id: 'cheese', name: 'مصنع جبن', desc: 'تحويل الحليب إلى جبن', cost: 6000, unlockLevel: 12, input: 'حليب', inputQty: 6, output: 'جبن', outputQty: 3, outputValue: 120, prodTime: 4 * 3600 * 1000, xp: 25 },
  { id: 'jam', name: 'مصنع مربى', desc: 'صنع مربى من العنب', cost: 8000, unlockLevel: 15, input: 'grape', inputQty: 10, output: 'مربى', outputQty: 5, outputValue: 100, prodTime: 3 * 3600 * 1000, xp: 30 },
  { id: 'oil', name: 'مصنع زيت', desc: 'عصر الزيتون لإنتاج زيت', cost: 12000, unlockLevel: 18, input: 'olive', inputQty: 12, output: 'زيت_زيتون', outputQty: 4, outputValue: 200, prodTime: 5 * 3600 * 1000, xp: 40 },
  { id: 'winery', name: 'مصنع عصير', desc: 'تخمير العنب لإنتاج عصير فاخر', cost: 15000, unlockLevel: 20, input: 'grape', inputQty: 15, output: 'عصير_فاخر', outputQty: 3, outputValue: 350, prodTime: 8 * 3600 * 1000, xp: 50 },
  { id: 'textile', name: 'مصنع نسيج', desc: 'تحويل القطن إلى أقمشة', cost: 18000, unlockLevel: 22, input: 'cotton', inputQty: 10, output: 'قماش', outputQty: 4, outputValue: 280, prodTime: 6 * 3600 * 1000, xp: 45 },
];

const PREMIUM = [
  { id: 'auto_water', name: 'ري تلقائي', desc: 'يروي محاصيلك تلقائياً', cost: 500, emoji: '💧' },
  { id: 'auto_harvest', name: 'حصاد تلقائي', desc: 'يحصد محاصيلك الجاهزة تلقائياً', cost: 1000, emoji: '🌾' },
  { id: 'auto_plant', name: 'زراعة تلقائية', desc: 'يزرع تلقائياً بعد الحصاد', cost: 1500, emoji: '🌱' },
  { id: 'auto_collect', name: 'جمع تلقائي', desc: 'يجمع إنتاج الحيوانات تلقائياً', cost: 800, emoji: '📦' },
  { id: 'double_xp', name: 'XP مضاعف', desc: 'تحصل على ضعف XP لمدة 24 ساعة', cost: 300, emoji: '⭐', duration: 86400 * 1000 },
];

const INVENTORY_LEVELS = { 1: 50, 2: 100, 3: 200, 4: 500, 5: 1000 };
const INVENTORY_UPGRADE_COSTS = { 2: 500, 3: 2000, 4: 8000, 5: 25000 };

// ======================== GLOBAL STATE ========================
let gameData = { players: {}, marketListings: [], chat: [], topups: [], withdrawals: [] };
let sseClients = {};

// ======================== UTILITY FUNCTIONS ========================
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function loadGameData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = fs.readFileSync(DATA_FILE, 'utf8');
      gameData = JSON.parse(data);
    } else {
      gameData = { players: {}, marketListings: [], chat: [], topups: [], withdrawals: [] };
      saveGameData();
    }
  } catch (e) {
    console.error('Error loading game data:', e);
    gameData = { players: {}, marketListings: [], chat: [], topups: [], withdrawals: [] };
  }
}

function saveGameData() {
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(gameData, null, 2));
  } catch (e) {
    console.error('Error saving game data:', e);
  }
}

function createNewPlayer(username) {
  return {
    username,
    passwordHash: '',
    token: '',
    msdk: 500,
    level: 1,
    xp: 0,
    plots: [
      { crop: null, plantedAt: null, watered: false },
      { crop: null, plantedAt: null, watered: false },
    ],
    inventory: {},
    invLevel: 1,
    ownedPens: {},
    ownedFactories: [],
    premiumFeatures: {},
    premiumExpires: {},
    lastAutoProcess: Date.now(),
    online: false,
    lastSeen: Date.now(),
  };
}

function findPlayerByToken(token) {
  for (const username in gameData.players) {
    if (gameData.players[username].token === token) {
      return { username, player: gameData.players[username] };
    }
  }
  return null;
}

function getCropByID(id) {
  return CROPS.find(c => c.id === id);
}

function getAnimalByID(id) {
  return ANIMALS.find(a => a.id === id);
}

function getPenByID(id) {
  return PENS.find(p => p.id === id);
}

function getFactoryByID(id) {
  return FACTORIES.find(f => f.id === id);
}

function getPremiumByID(id) {
  return PREMIUM.find(p => p.id === id);
}

function calculateXPNeeded(level) {
  return Math.floor(500 * Math.pow(level, 1.8));
}

function addXP(player, amount) {
  if (player.premiumFeatures.double_xp && player.premiumExpires.double_xp > Date.now()) {
    amount *= 2;
  }
  player.xp += amount;

  while (player.xp >= calculateXPNeeded(player.level)) {
    player.xp -= calculateXPNeeded(player.level);
    player.level += 1;
  }
}

function getInventoryCapacity(player) {
  return INVENTORY_LEVELS[Math.min(player.invLevel, 5)] || 1000;
}

function getInventoryUsed(player) {
  return Object.values(player.inventory).reduce((a, b) => a + b, 0);
}

function parsJSONBody(req, callback) {
  let body = '';
  req.on('data', chunk => {
    body += chunk.toString();
  });
  req.on('end', () => {
    try {
      const data = body ? JSON.parse(body) : {};
      callback(data);
    } catch {
      callback({});
    }
  });
}

function broadcast(event, data) {
  for (const clientId in sseClients) {
    if (sseClients[clientId] && sseClients[clientId].res && !sseClients[clientId].res.destroyed) {
      sseClients[clientId].res.write(`data: ${JSON.stringify({ event, data })}\n\n`);
    }
  }
}

function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function sendSSE(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  return res;
}

function serveStatic(res, filePath) {
  try {
    const fullPath = path.join(PUBLIC_DIR, filePath);
    if (!fullPath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      const content = fs.readFileSync(fullPath);
      const ext = path.extname(filePath).toLowerCase();
      let contentType = 'text/plain';
      if (ext === '.html') contentType = 'text/html';
      else if (ext === '.css') contentType = 'text/css';
      else if (ext === '.js') contentType = 'application/javascript';
      else if (ext === '.json') contentType = 'application/json';
      else if (ext === '.png') contentType = 'image/png';
      else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';

      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  } catch (e) {
    res.writeHead(500);
    res.end('Server Error');
  }
}

// ======================== AUTO-PROCESSING ========================
function processAutoFeatures() {
  for (const username in gameData.players) {
    const player = gameData.players[username];
    if (!player.online) continue;

    const now = Date.now();
    if (now - player.lastAutoProcess < 60000) continue;
    player.lastAutoProcess = now;

    // Auto-water
    if (player.premiumFeatures.auto_water) {
      for (const plot of player.plots) {
        if (plot.crop && !plot.watered) {
          plot.watered = true;
        }
      }
    }

    // Auto-harvest
    if (player.premiumFeatures.auto_harvest) {
      for (let i = 0; i < player.plots.length; i++) {
        const plot = player.plots[i];
        if (plot.crop && plot.watered && plot.plantedAt) {
          const crop = getCropByID(plot.crop);
          if (crop && now - plot.plantedAt >= crop.growTime) {
            addInventoryItem(player, plot.crop, 1);
            addXP(player, crop.xp);
            plot.crop = null;
            plot.plantedAt = null;
            plot.watered = false;
          }
        }
      }
    }

    // Auto-plant
    if (player.premiumFeatures.auto_plant) {
      for (const plot of player.plots) {
        if (!plot.crop) {
          const crop = getCropByID('onion');
          if (crop && player.msdk >= crop.cost && getInventoryUsed(player) < getInventoryCapacity(player)) {
            player.msdk -= crop.cost;
            plot.crop = 'onion';
            plot.plantedAt = Date.now();
            plot.watered = false;
          }
        }
      }
    }

    // Auto-collect
    if (player.premiumFeatures.auto_collect) {
      for (const penId in player.ownedPens) {
        const pen = player.ownedPens[penId];
        if (!pen.animals) continue;

        const animalDef = getAnimalByID(pen.animalId);
        if (!animalDef) continue;

        for (const animal of pen.animals) {
          if (now - animal.lastCollect >= animalDef.prodTime) {
            addInventoryItem(player, animalDef.product, 1);
            addXP(player, animalDef.xp);
            animal.lastCollect = now;
          }
        }
      }
    }
  }
  saveGameData();
}

function addInventoryItem(player, itemId, qty) {
  if (!player.inventory[itemId]) player.inventory[itemId] = 0;
  const used = getInventoryUsed(player);
  const capacity = getInventoryCapacity(player);
  const canAdd = Math.min(qty, capacity - used);
  player.inventory[itemId] += canAdd;
}

// ======================== REQUEST HANDLER ========================
const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const query = parsedUrl.query;

  // Static files
  if (pathname === '/' || pathname.startsWith('/public/') || pathname.match(/\.(html|css|js|png|jpg|json)$/)) {
    const filePath = pathname === '/' ? '/index.html' : pathname;
    serveStatic(res, filePath);
    return;
  }

  // ======================== AUTH ROUTES ========================
  if (pathname === '/api/register' && req.method === 'POST') {
    parsJSONBody(req, (data) => {
      const { username, password } = data;
      if (!username || !password) return sendJSON(res, 400, { error: 'Missing credentials' });
      if (gameData.players[username]) return sendJSON(res, 400, { error: 'User exists' });

      const player = createNewPlayer(username);
      player.passwordHash = hashPassword(password);
      player.token = generateToken();
      gameData.players[username] = player;
      saveGameData();

      return sendJSON(res, 201, { token: player.token, username });
    });
    return;
  }

  if (pathname === '/api/login' && req.method === 'POST') {
    parsJSONBody(req, (data) => {
      const { username, password } = data;
      if (!username || !password) return sendJSON(res, 400, { error: 'Missing credentials' });

      const player = gameData.players[username];
      if (!player || player.passwordHash !== hashPassword(password)) {
        return sendJSON(res, 401, { error: 'Invalid credentials' });
      }

      player.token = generateToken();
      player.online = true;
      player.lastSeen = Date.now();
      saveGameData();

      return sendJSON(res, 200, { token: player.token, username });
    });
    return;
  }

  // Auth middleware
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  const auth = findPlayerByToken(token);

  if (!auth && pathname !== '/' && !pathname.match(/^\/public\//)) {
    return sendJSON(res, 401, { error: 'Unauthorized' });
  }

  const { username, player } = auth || {};

  // ======================== CROP ROUTES ========================
  if (pathname === '/api/crops' && req.method === 'GET') {
    return sendJSON(res, 200, CROPS);
  }

  if (pathname === '/api/plant' && req.method === 'POST') {
    parsJSONBody(req, (data) => {
      const { plotIndex, cropId } = data;
      if (typeof plotIndex !== 'number' || !cropId) {
        return sendJSON(res, 400, { error: 'Invalid data' });
      }

      const crop = getCropByID(cropId);
      if (!crop) return sendJSON(res, 400, { error: 'Crop not found' });
      if (player.msdk < crop.cost) return sendJSON(res, 400, { error: 'Not enough MSDK' });
      if (!player.plots[plotIndex]) return sendJSON(res, 400, { error: 'Plot not found' });

      const plot = player.plots[plotIndex];
      if (plot.crop) return sendJSON(res, 400, { error: 'Plot occupied' });

      player.msdk -= crop.cost;
      plot.crop = cropId;
      plot.plantedAt = Date.now();
      plot.watered = false;

      broadcast('game-update', { type: 'crop-planted', username, plotIndex, cropId });
      saveGameData();

      return sendJSON(res, 200, { success: true });
    });
    return;
  }

  if (pathname === '/api/water' && req.method === 'POST') {
    parsJSONBody(req, (data) => {
      const { plotIndex } = data;
      if (typeof plotIndex !== 'number') return sendJSON(res, 400, { error: 'Invalid data' });

      const plot = player.plots[plotIndex];
      if (!plot || !plot.crop) return sendJSON(res, 400, { error: 'No crop in plot' });
      if (plot.watered) return sendJSON(res, 400, { error: 'Already watered' });

      plot.watered = true;
      saveGameData();

      return sendJSON(res, 200, { success: true });
    });
    return;
  }

  if (pathname === '/api/harvest' && req.method === 'POST') {
    parsJSONBody(req, (data) => {
      const { plotIndex } = data;
      if (typeof plotIndex !== 'number') return sendJSON(res, 400, { error: 'Invalid data' });

      const plot = player.plots[plotIndex];
      if (!plot || !plot.crop) return sendJSON(res, 400, { error: 'No crop in plot' });

      const crop = getCropByID(plot.crop);
      if (!crop || !plot.watered || Date.now() - plot.plantedAt < crop.growTime) {
        return sendJSON(res, 400, { error: 'Crop not ready' });
      }

      if (getInventoryUsed(player) >= getInventoryCapacity(player)) {
        return sendJSON(res, 400, { error: 'Inventory full' });
      }

      addInventoryItem(player, plot.crop, 1);
      addXP(player, crop.xp);
      plot.crop = null;
      plot.plantedAt = null;
      plot.watered = false;

      broadcast('game-update', { type: 'harvest', username });
      saveGameData();

      return sendJSON(res, 200, { success: true, xp: crop.xp });
    });
    return;
  }

  // ======================== ANIMAL/PEN ROUTES ========================
  if (pathname === '/api/pens' && req.method === 'GET') {
    return sendJSON(res, 200, PENS.map(p => ({ ...p, owned: player.ownedPens.hasOwnProperty(p.id) })));
  }

  if (pathname === '/api/buy-pen' && req.method === 'POST') {
    parsJSONBody(req, (data) => {
      const { penId } = data;
      const pen = getPenByID(penId);
      if (!pen) return sendJSON(res, 400, { error: 'Pen not found' });
      if (player.level < pen.unlockLevel) return sendJSON(res, 400, { error: 'Level too low' });
      if (player.msdk < pen.cost) return sendJSON(res, 400, { error: 'Not enough MSDK' });

      if (player.ownedPens[penId]) {
        return sendJSON(res, 400, { error: 'Pen already owned' });
      }

      player.msdk -= pen.cost;
      player.ownedPens[penId] = { level: 1, animals: [], animalId: pen.animalId };
      saveGameData();

      return sendJSON(res, 200, { success: true });
    });
    return;
  }

  if (pathname === '/api/animals' && req.method === 'GET') {
    return sendJSON(res, 200, ANIMALS);
  }

  if (pathname === '/api/buy-animal' && req.method === 'POST') {
    parsJSONBody(req, (data) => {
      const { animalId } = data;
      const animal = getAnimalByID(animalId);
      if (!animal) return sendJSON(res, 400, { error: 'Animal not found' });
      if (player.level < animal.unlockLevel) return sendJSON(res, 400, { error: 'Level too low' });
      if (player.msdk < animal.cost) return sendJSON(res, 400, { error: 'Not enough MSDK' });

      const pen = player.ownedPens[animal.penId];
      if (!pen) return sendJSON(res, 400, { error: 'Need pen first' });
      if (pen.animals.length >= PENS.find(p => p.id === animal.penId).capacity) {
        return sendJSON(res, 400, { error: 'Pen full' });
      }

      player.msdk -= animal.cost;
      pen.animals.push({ boughtAt: Date.now(), lastCollect: Date.now() });
      saveGameData();

      return sendJSON(res, 200, { success: true });
    });
    return;
  }

  if (pathname === '/api/collect' && req.method === 'POST') {
    parsJSONBody(req, (data) => {
      const { penId } = data;
      const pen = player.ownedPens[penId];
      if (!pen || !pen.animals) return sendJSON(res, 400, { error: 'Pen not found' });

      const animal = getAnimalByID(pen.animalId);
      if (!animal) return sendJSON(res, 400, { error: 'Animal type not found' });

      let collected = 0;
      let xpGain = 0;

      for (let i = 0; i < pen.animals.length; i++) {
        const instance = pen.animals[i];
        if (Date.now() - instance.lastCollect >= animal.prodTime) {
          if (getInventoryUsed(player) < getInventoryCapacity(player)) {
            addInventoryItem(player, animal.product, 1);
            xpGain += animal.xp;
            collected++;
            instance.lastCollect = Date.now();
          }
        }
      }

      if (collected === 0) return sendJSON(res, 400, { error: 'Nothing to collect' });

      addXP(player, xpGain);
      saveGameData();

      return sendJSON(res, 200, { success: true, collected, xp: xpGain });
    });
    return;
  }

  // ======================== LAND ROUTES ========================
  if (pathname === '/api/buy-land' && req.method === 'POST') {
    const plotCount = player.plots.length;
    const landCost = 200 * Math.pow(2, plotCount - 2);

    if (player.msdk < landCost) return sendJSON(res, 400, { error: 'Not enough MSDK' });

    player.msdk -= landCost;
    player.plots.push({ crop: null, plantedAt: null, watered: false });
    saveGameData();

    return sendJSON(res, 200, { success: true, totalPlots: player.plots.length });
  }

  // ======================== INVENTORY ROUTES ========================
  if (pathname === '/api/inventory' && req.method === 'GET') {
    const capacity = getInventoryCapacity(player);
    const used = getInventoryUsed(player);

    return sendJSON(res, 200, {
      items: player.inventory,
      level: player.invLevel,
      capacity,
      used,
      canUpgrade: player.invLevel < 5,
      upgradeCost: INVENTORY_UPGRADE_COSTS[player.invLevel + 1] || null,
    });
  }

  if (pathname === '/api/upgrade-inventory' && req.method === 'POST') {
    const nextLevel = player.invLevel + 1;
    if (nextLevel > 5) return sendJSON(res, 400, { error: 'Max level' });

    const cost = INVENTORY_UPGRADE_COSTS[nextLevel];
    if (player.msdk < cost) return sendJSON(res, 400, { error: 'Not enough MSDK' });

    player.msdk -= cost;
    player.invLevel = nextLevel;
    saveGameData();

    return sendJSON(res, 200, { success: true, newLevel: nextLevel });
  }

  // ======================== FACTORY ROUTES ========================
  if (pathname === '/api/factories' && req.method === 'GET') {
    return sendJSON(res, 200, FACTORIES.map(f => ({
      ...f,
      unlocked: player.level >= f.unlockLevel,
      ownedCount: player.ownedFactories.filter(of => of.factoryId === f.id).length,
    })));
  }

  if (pathname === '/api/buy-factory' && req.method === 'POST') {
    parsJSONBody(req, (data) => {
      const { factoryId } = data;
      const factory = getFactoryByID(factoryId);
      if (!factory) return sendJSON(res, 400, { error: 'Factory not found' });
      if (player.level < factory.unlockLevel) return sendJSON(res, 400, { error: 'Level too low' });
      if (player.msdk < factory.cost) return sendJSON(res, 400, { error: 'Not enough MSDK' });

      player.msdk -= factory.cost;
      player.ownedFactories.push({ factoryId, startedAt: null, producing: false });
      saveGameData();

      return sendJSON(res, 200, { success: true });
    });
    return;
  }

  if (pathname === '/api/start-production' && req.method === 'POST') {
    parsJSONBody(req, (data) => {
      const { factoryIndex } = data;
      const ownedFactory = player.ownedFactories[factoryIndex];
      if (!ownedFactory) return sendJSON(res, 400, { error: 'Factory not found' });

      const factory = getFactoryByID(ownedFactory.factoryId);
      const inputQty = player.inventory[factory.input] || 0;

      if (inputQty < factory.inputQty) {
        return sendJSON(res, 400, { error: `Need ${factory.inputQty} ${factory.input}` });
      }
      if (ownedFactory.producing) {
        return sendJSON(res, 400, { error: 'Already producing' });
      }

      player.inventory[factory.input] -= factory.inputQty;
      ownedFactory.startedAt = Date.now();
      ownedFactory.producing = true;
      saveGameData();

      return sendJSON(res, 200, { success: true });
    });
    return;
  }

  if (pathname === '/api/collect-factory' && req.method === 'POST') {
    parsJSONBody(req, (data) => {
      const { factoryIndex } = data;
      const ownedFactory = player.ownedFactories[factoryIndex];
      if (!ownedFactory) return sendJSON(res, 400, { error: 'Factory not found' });
      if (!ownedFactory.producing) return sendJSON(res, 400, { error: 'Not producing' });

      const factory = getFactoryByID(ownedFactory.factoryId);
      if (Date.now() - ownedFactory.startedAt < factory.prodTime) {
        return sendJSON(res, 400, { error: 'Not ready' });
      }

      if (getInventoryUsed(player) >= getInventoryCapacity(player)) {
        return sendJSON(res, 400, { error: 'Inventory full' });
      }

      addInventoryItem(player, factory.output, factory.outputQty);
      addXP(player, factory.xp);
      ownedFactory.producing = false;
      ownedFactory.startedAt = null;
      saveGameData();

      return sendJSON(res, 200, { success: true, xp: factory.xp });
    });
    return;
  }

  // ======================== MARKET ROUTES ========================
  if (pathname === '/api/market/listings' && req.method === 'GET') {
    return sendJSON(res, 200, gameData.marketListings);
  }

  if (pathname === '/api/market/list' && req.method === 'POST') {
    parsJSONBody(req, (data) => {
      const { item, qty, pricePerUnit } = data;
      if (!item || !qty || !pricePerUnit) return sendJSON(res, 400, { error: 'Invalid data' });

      const invQty = player.inventory[item] || 0;
      if (invQty < qty) return sendJSON(res, 400, { error: 'Not enough items' });

      player.inventory[item] -= qty;
      const listing = {
        id: crypto.randomBytes(8).toString('hex'),
        seller: username,
        item,
        qty,
        pricePerUnit,
        listedAt: Date.now(),
      };
      gameData.marketListings.push(listing);

      broadcast('market-update', { type: 'new-listing', listing });
      saveGameData();

      return sendJSON(res, 200, { success: true, listingId: listing.id });
    });
    return;
  }

  if (pathname === '/api/market/buy' && req.method === 'POST') {
    parsJSONBody(req, (data) => {
      const { listingId } = data;
      const listing = gameData.marketListings.find(l => l.id === listingId);
      if (!listing) return sendJSON(res, 400, { error: 'Listing not found' });

      const totalCost = listing.qty * listing.pricePerUnit;
      if (player.msdk < totalCost) return sendJSON(res, 400, { error: 'Not enough MSDK' });

      const capacityLeft = getInventoryCapacity(player) - getInventoryUsed(player);
      if (capacityLeft < listing.qty) return sendJSON(res, 400, { error: 'Inventory full' });

      const seller = gameData.players[listing.seller];
      if (!seller) return sendJSON(res, 400, { error: 'Seller not found' });

      player.msdk -= totalCost;
      seller.msdk += totalCost;
      addInventoryItem(player, listing.item, listing.qty);

      gameData.marketListings = gameData.marketListings.filter(l => l.id !== listingId);

      broadcast('market-update', { type: 'purchase', listingId, buyer: username });
      saveGameData();

      return sendJSON(res, 200, { success: true });
    });
    return;
  }

  // ======================== PREMIUM ROUTES ========================
  if (pathname === '/api/premium' && req.method === 'GET') {
    return sendJSON(res, 200, PREMIUM.map(p => ({
      ...p,
      owned: player.premiumFeatures.hasOwnProperty(p.id),
      expiresAt: player.premiumExpires[p.id] || null,
    })));
  }

  if (pathname === '/api/buy-premium' && req.method === 'POST') {
    parsJSONBody(req, (data) => {
      const { featureId } = data;
      const premium = getPremiumByID(featureId);
      if (!premium) return sendJSON(res, 400, { error: 'Feature not found' });
      if (player.msdk < premium.cost) return sendJSON(res, 400, { error: 'Not enough MSDK' });

      player.msdk -= premium.cost;
      player.premiumFeatures[featureId] = true;
      if (premium.duration) {
        player.premiumExpires[featureId] = Date.now() + premium.duration;
      }
      saveGameData();

      return sendJSON(res, 200, { success: true });
    });
    return;
  }

  // ======================== TOPUP ROUTES ========================
  if (pathname === '/api/topup/create' && req.method === 'POST') {
    parsJSONBody(req, (data) => {
      const { amount, currency, txHash } = data;
      if (!amount || !currency) return sendJSON(res, 400, { error: 'Invalid data' });

      const topupId = crypto.randomBytes(8).toString('hex');
      const wallets = {
        'USDT_TRC20': process.env.WALLET_USDT || 'TN7isGhAP5ynyGutzYSkaEVRiMwqjBW9BJ',
        'BTC': process.env.WALLET_BTC || '1A1z7agoat4WFhUuCg6N6xWxYu5P9nUVZX',
        'ETH': process.env.WALLET_ETH || '0x742d35Cc6634C0532925a3b844Bc9e7595f42aE1',
      };

      const topup = {
        id: topupId,
        username,
        amount,
        currency,
        txHash: txHash || '',
        walletAddress: wallets[currency] || 'unknown',
        status: 'pending',
        requestedAt: Date.now(),
      };
      gameData.topups.push(topup);
      saveGameData();

      return sendJSON(res, 201, {
        topupId,
        paymentId: topupId,
        amount,
        currency,
        walletAddress: topup.walletAddress,
      });
    });
    return;
  }

  if (pathname.match(/^\/api\/topup\/check\//) && req.method === 'GET') {
    const paymentId = pathname.split('/')[4];
    const topup = gameData.topups.find(t => t.id === paymentId);
    if (!topup) return sendJSON(res, 404, { error: 'Payment not found' });

    return sendJSON(res, 200, { status: topup.status, amount: topup.amount });
  }

  if (pathname === '/api/topup/webhook' && req.method === 'POST') {
    parsJSONBody(req, (data) => {
      const { payment_id, status } = data;
      const topup = gameData.topups.find(t => t.id === payment_id);
      if (!topup) return sendJSON(res, 404, { error: 'Payment not found' });

      if (status === 'finished') {
        topup.status = 'completed';
        const topupPlayer = gameData.players[topup.username];
        if (topupPlayer) {
          topupPlayer.msdk += topup.amount;
        }
        saveGameData();
      }

      return sendJSON(res, 200, { success: true });
    });
    return;
  }

  // ======================== WITHDRAWAL ROUTES ========================
  if (pathname === '/api/withdraw/request' && req.method === 'POST') {
    parsJSONBody(req, (data) => {
      const { amount, walletAddress, currency } = data;
      if (!amount || !walletAddress || !currency) return sendJSON(res, 400, { error: 'Invalid data' });
      if (amount < 100) return sendJSON(res, 400, { error: 'Minimum 100 MSDK' });
      if (player.msdk < amount) return sendJSON(res, 400, { error: 'Not enough MSDK' });

      const withdrawId = crypto.randomBytes(8).toString('hex');
      const withdrawal = {
        id: withdrawId,
        username,
        amount,
        walletAddress,
        currency,
        status: 'pending',
        requestedAt: Date.now(),
      };

      player.msdk -= amount;
      gameData.withdrawals.push(withdrawal);
      saveGameData();

      return sendJSON(res, 201, { withdrawalId: withdrawId });
    });
    return;
  }

  if (pathname === '/api/withdraw/history' && req.method === 'GET') {
    const userWithdrawals = gameData.withdrawals.filter(w => w.username === username);
    return sendJSON(res, 200, userWithdrawals);
  }

  // ======================== PLAYER/PROFILE ROUTES ========================
  if (pathname === '/api/player' && req.method === 'GET') {
    return sendJSON(res, 200, {
      username,
      msdk: player.msdk,
      level: player.level,
      xp: player.xp,
      xpNeeded: calculateXPNeeded(player.level),
      plots: player.plots.length,
      online: player.online,
    });
  }

  if (pathname === '/api/player/full' && req.method === 'GET') {
    return sendJSON(res, 200, player);
  }

  if (pathname === '/api/logout' && req.method === 'POST') {
    player.online = false;
    player.lastSeen = Date.now();
    saveGameData();
    return sendJSON(res, 200, { success: true });
  }

  // ======================== CHAT ROUTES ========================
  if (pathname === '/api/chat/send' && req.method === 'POST') {
    parsJSONBody(req, (data) => {
      const { message } = data;
      if (!message || message.length > 500) return sendJSON(res, 400, { error: 'Invalid message' });

      const chatMsg = {
        username,
        message,
        timestamp: Date.now(),
      };
      gameData.chat.push(chatMsg);
      if (gameData.chat.length > 100) gameData.chat.shift();

      broadcast('chat-message', chatMsg);
      saveGameData();

      return sendJSON(res, 200, { success: true });
    });
    return;
  }

  if (pathname === '/api/chat/messages' && req.method === 'GET') {
    return sendJSON(res, 200, gameData.chat.slice(-50));
  }

  // ======================== SSE ROUTES ========================
  if (pathname === '/api/events' && req.method === 'GET') {
    const clientId = crypto.randomBytes(8).toString('hex');
    const sseRes = sendSSE(res);
    sseClients[clientId] = { res: sseRes, username };

    sseRes.write(`: connected\n\n`);

    req.on('close', () => {
      delete sseClients[clientId];
    });
    return;
  }

  // ======================== ADMIN ROUTES ========================
  if (pathname === '/api/admin/stats' && req.method === 'GET') {
    if (username !== ADMIN_USERNAME) return sendJSON(res, 403, { error: 'Admin only' });

    const onlineCount = Object.values(gameData.players).filter(p => p.online).length;
    const totalMSDK = Object.values(gameData.players).reduce((a, p) => a + p.msdk, 0);
    const pendingTopups = gameData.topups.filter(t => t.status === 'pending').length;
    const pendingWithdrawals = gameData.withdrawals.filter(w => w.status === 'pending').length;

    return sendJSON(res, 200, {
      totalPlayers: Object.keys(gameData.players).length,
      onlineCount,
      totalMSDK,
      pendingTopups,
      pendingWithdrawals,
    });
  }

  if (pathname === '/api/admin/topups' && req.method === 'GET') {
    if (username !== ADMIN_USERNAME) return sendJSON(res, 403, { error: 'Admin only' });
    return sendJSON(res, 200, gameData.topups || []);
  }

  if (pathname === '/api/admin/withdrawals' && req.method === 'GET') {
    if (username !== ADMIN_USERNAME) return sendJSON(res, 403, { error: 'Admin only' });
    return sendJSON(res, 200, gameData.withdrawals || []);
  }

  if (pathname === '/api/admin/players' && req.method === 'GET') {
    if (username !== ADMIN_USERNAME) return sendJSON(res, 403, { error: 'Admin only' });

    const players = Object.entries(gameData.players).map(([name, p]) => ({
      username: name,
      msdk: p.msdk,
      level: p.level,
      online: p.online,
      lastSeen: p.lastSeen,
    }));

    return sendJSON(res, 200, players);
  }

  if (pathname === '/api/admin/grant' && req.method === 'POST') {
    if (username !== ADMIN_USERNAME) return sendJSON(res, 403, { error: 'Admin only' });

    parsJSONBody(req, (data) => {
      const { username: targetUser, amount } = data;
      if (!targetUser || !amount) return sendJSON(res, 400, { error: 'Invalid data' });

      const targetPlayer = gameData.players[targetUser];
      if (!targetPlayer) return sendJSON(res, 404, { error: 'Player not found' });

      targetPlayer.msdk += amount;
      saveGameData();

      return sendJSON(res, 200, { success: true, newBalance: targetPlayer.msdk });
    });
    return;
  }

  if (pathname === '/api/admin/topup/approve' && req.method === 'POST') {
    if (username !== ADMIN_USERNAME) return sendJSON(res, 403, { error: 'Admin only' });

    parsJSONBody(req, (data) => {
      const { topupId } = data;
      const topup = gameData.topups.find(t => t.id === topupId);
      if (!topup) return sendJSON(res, 404, { error: 'Topup not found' });

      topup.status = 'approved';
      const topupPlayer = gameData.players[topup.username];
      if (topupPlayer) topupPlayer.msdk += topup.amount;
      saveGameData();

      return sendJSON(res, 200, { success: true });
    });
    return;
  }

  if (pathname === '/api/admin/topup/reject' && req.method === 'POST') {
    if (username !== ADMIN_USERNAME) return sendJSON(res, 403, { error: 'Admin only' });

    parsJSONBody(req, (data) => {
      const { topupId } = data;
      const topup = gameData.topups.find(t => t.id === topupId);
      if (!topup) return sendJSON(res, 404, { error: 'Topup not found' });

      topup.status = 'rejected';
      saveGameData();

      return sendJSON(res, 200, { success: true });
    });
    return;
  }

  if (pathname === '/api/admin/withdraw/approve' && req.method === 'POST') {
    if (username !== ADMIN_USERNAME) return sendJSON(res, 403, { error: 'Admin only' });

    parsJSONBody(req, (data) => {
      const { withdrawId } = data;
      const withdrawal = gameData.withdrawals.find(w => w.id === withdrawId);
      if (!withdrawal) return sendJSON(res, 404, { error: 'Withdrawal not found' });

      withdrawal.status = 'approved';
      saveGameData();

      return sendJSON(res, 200, { success: true });
    });
    return;
  }

  if (pathname === '/api/admin/withdraw/reject' && req.method === 'POST') {
    if (username !== ADMIN_USERNAME) return sendJSON(res, 403, { error: 'Admin only' });

    parsJSONBody(req, (data) => {
      const { withdrawId } = data;
      const withdrawal = gameData.withdrawals.find(w => w.id === withdrawId);
      if (!withdrawal) return sendJSON(res, 404, { error: 'Withdrawal not found' });

      const targetPlayer = gameData.players[withdrawal.username];
      if (targetPlayer) targetPlayer.msdk += withdrawal.amount;

      withdrawal.status = 'rejected';
      saveGameData();

      return sendJSON(res, 200, { success: true });
    });
    return;
  }

  // 404
  sendJSON(res, 404, { error: 'Not found' });
});

// ======================== STARTUP ========================
loadGameData();

// Auto-save every 30 seconds
setInterval(() => {
  saveGameData();
}, 30000);

// Auto-process premium features every 60 seconds
setInterval(() => {
  processAutoFeatures();
}, 60000);

server.listen(PORT, () => {
  console.log(`MSDK Farm server running on port ${PORT}`);
});
