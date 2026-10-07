/**
 * AURIS OPEN – Tournament Portal (Google Apps Script backend)
 * Database: the Google Sheet this script is attached to.
 * Free: runs on your Google account only.
 *
 * First time:  Run  setup()  once from the Apps Script editor (grants permissions, builds tabs).
 * Then:        Deploy > New deployment > Web app > Execute as: Me, Who has access: Anyone.
 */

// Leave blank when the script is attached to the sheet (Extensions > Apps Script).
var SHEET_ID = '';
var SCREENSHOT_FOLDER = 'Auris Open - Payment Screenshots';
var SESSION_HOURS = 6;

var TABS = {
  Settings:   ['Key', 'Value', 'Notes'],
  Users:      ['Name', 'Role', 'PIN', 'Active'],
  Categories: ['CategoryID', 'Name', 'Type', 'Format', 'Groups', 'Fee', 'MaxEntries', 'SlotMinutes', 'Status', 'Order', 'Notes'],
  Entries:    ['EntryID', 'RegID', 'Timestamp', 'CategoryID', 'Player1', 'P1Tower', 'P1Flat', 'P1Phone',
               'Player2', 'P2Tower', 'P2Flat', 'P2Phone', 'LastTournament', 'LastCategory', 'LastResult',
               'Fee', 'PaymentMode', 'PaymentRef', 'ScreenshotID', 'PaymentStatus', 'ApprovedBy', 'ApprovedAt',
               'Seed', 'Group', 'Status', 'Remarks'],
  Matches:    ['MatchID', 'CategoryID', 'Stage', 'Round', 'RoundNo', 'Group', 'MatchNo', 'SideA', 'SideB',
               'NextMatch', 'NextSlot', 'Date', 'Time', 'Court', 'Score', 'Winner', 'Result',
               'EnteredBy', 'EnteredAt', 'Notes'],
  Accounts:   ['TxnID', 'Date', 'Type', 'Head', 'Description', 'Amount', 'Mode', 'Party', 'Reference', 'EnteredBy', 'EnteredAt'],
  Log:        ['Timestamp', 'User', 'Action', 'Details']
};

var DEFAULT_SETTINGS = [
  ['TournamentName', 'Auris Open 2026', 'Shown on every page'],
  ['Tagline', 'Auris Serenity Towers 1, 2 & 3', ''],
  ['Venue', 'Auris Serenity society tennis court', ''],
  ['Dates', 'To be confirmed', 'Free text shown to players'],
  ['About', 'Our annual society tennis tournament. Register below, pay the entry fee and check your draw and match times here.', ''],
  ['RegistrationOpen', 'Yes', 'Yes / No'],
  ['MaxCategoriesPerPlayer', '2', 'Per person (by phone number)'],
  ['UPIId', '', 'e.g. organiser@okhdfcbank – used for the QR code'],
  ['UPIName', 'Auris Open Organising Committee', 'Payee name shown in UPI apps'],
  ['PaymentNote', 'Pay by UPI and upload the screenshot, or choose Cash and hand it to the organiser. Your entry is confirmed once the organiser approves it.', ''],
  ['ContactName', '', 'Organiser to contact'],
  ['ContactPhone', '', ''],
  ['PlayDays', '2026-11-07 07:00-19:00\n2026-11-08 07:00-19:00', 'One line per day: YYYY-MM-DD HH:MM-HH:MM (add weekday evenings as extra lines)'],
  ['Courts', '1', 'Number of courts'],
  ['DefaultSlotMinutes', '40', 'Minutes per match incl. changeover (category can override)'],
  ['RestMinutes', '30', 'Minimum gap between two matches of the same player'],
  ['IncomeHeads', 'Donation, Society contribution, Sponsorship, Other income', 'Entry fees are counted automatically'],
  ['ExpenseHeads', 'Balls, Trophies & medals, Refreshments, Referees, Court & equipment, Printing & banners, First aid, Miscellaneous', ''],
  ['Rules', 'Report 15 minutes before your match time.\nA player not on court 10 minutes after the call loses by walkover.\nMatch format for each round is announced by the organisers.\nThe referee\'s decision is final.', 'Shown on the Home page']
];

var DEFAULT_CATEGORIES = [
  ['MS', "Men's Singles", 'Singles', 'Knockout', 1, 500, 32, '', 'Open', 1, ''],
  ['WS', "Women's Singles", 'Singles', 'Round Robin', 1, 500, 16, '', 'Open', 2, ''],
  ['MD', "Men's Doubles", 'Doubles', 'Knockout', 1, 800, 16, '', 'Open', 3, 'Fee per pair'],
  ['WD', "Women's Doubles", 'Doubles', 'Round Robin', 1, 800, 8, '', 'Open', 4, 'Fee per pair'],
  ['XD', 'Mixed Doubles', 'Doubles', 'Knockout', 1, 800, 16, '', 'Open', 5, 'Fee per pair'],
  ['JR', 'Juniors (U-14)', 'Singles', 'Round Robin', 1, 300, 16, 30, 'Open', 6, '']
];

/* ======================= WEB APP ======================= */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Auris Open')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1');
}

/** Single entry point used by the page: google.script.run.api(action, payloadJson, token) */
function api(action, payloadJson, token) {
  try {
    var p = payloadJson ? JSON.parse(payloadJson) : {};
    var fn = ACTIONS[action];
    if (!fn) throw new Error('Unknown action: ' + action);
    var user = null;
    if (fn.role) {
      user = checkToken_(token);
      if (!user) throw new Error('Session expired. Please log in again.');
      if (fn.role === 'Admin' && user.role !== 'Admin') throw new Error('Only an Admin can do this.');
      if (fn.role === 'Organiser' && user.role === 'Scorer') throw new Error('Scorers can only enter scores.');
    }
    var out;
    if (fn.write) {
      var lock = LockService.getScriptLock();
      lock.waitLock(20000);
      try { out = fn.run(p, user); } finally { lock.releaseLock(); }
    } else {
      out = fn.run(p, user);
    }
    return JSON.stringify({ ok: true, data: out === undefined ? null : out });
  } catch (e) {
    return JSON.stringify({ ok: false, error: String(e && e.message || e) });
  }
}

var ACTIONS = {
  // ---- public ----
  getPublic:   { run: function () { return publicData_(); } },
  register:    { write: true, run: function (p) { return register_(p); } },
  lookup:      { run: function (p) { return lookup_(p.phone); } },
  login:       { run: function (p) { return login_(p.name, p.pin); } },
  // ---- scorer + above ----
  getScorer:   { role: 'Scorer', run: function () { return scorerData_(); } },
  saveScore:   { role: 'Scorer', write: true, run: function (p, u) { return saveScore_(p, u); } },
  // ---- organiser + admin ----
  getAdmin:    { role: 'Organiser', run: function (p, u) { return adminData_(u); } },
  setPayment:  { role: 'Organiser', write: true, run: function (p, u) { return setPayment_(p, u); } },
  updateEntry: { role: 'Organiser', write: true, run: function (p, u) { return updateEntry_(p, u); } },
  addEntry:    { role: 'Organiser', write: true, run: function (p, u) { return addEntryAdmin_(p, u); } },
  deleteEntry: { role: 'Organiser', write: true, run: function (p, u) { return deleteEntry_(p, u); } },
  getScreenshot: { role: 'Organiser', run: function (p) { return getScreenshot_(p.id); } },
  saveCategory:  { role: 'Organiser', write: true, run: function (p, u) { return saveCategory_(p, u); } },
  deleteCategory:{ role: 'Organiser', write: true, run: function (p, u) { return deleteCategory_(p, u); } },
  generateDraw:  { role: 'Organiser', write: true, run: function (p, u) { return generateDraw_(p, u); } },
  clearDraw:     { role: 'Organiser', write: true, run: function (p, u) { return clearDraw_(p, u); } },
  editMatch:     { role: 'Organiser', write: true, run: function (p, u) { return editMatch_(p, u); } },
  addMatch:      { role: 'Organiser', write: true, run: function (p, u) { return addMatch_(p, u); } },
  deleteMatch:   { role: 'Organiser', write: true, run: function (p, u) { return deleteMatch_(p, u); } },
  clearScore:    { role: 'Organiser', write: true, run: function (p, u) { return clearScore_(p, u); } },
  autoSchedule:  { role: 'Organiser', write: true, run: function (p, u) { return autoSchedule_(p, u); } },
  saveTxn:       { role: 'Organiser', write: true, run: function (p, u) { return saveTxn_(p, u); } },
  deleteTxn:     { role: 'Organiser', write: true, run: function (p, u) { return deleteTxn_(p, u); } },
  // ---- admin only ----
  saveSettings:  { role: 'Admin', write: true, run: function (p, u) { return saveSettings_(p, u); } },
  saveUser:      { role: 'Admin', write: true, run: function (p, u) { return saveUser_(p, u); } },
  deleteUser:    { role: 'Admin', write: true, run: function (p, u) { return deleteUser_(p, u); } }
};

/* ======================= SETUP ======================= */

function setup() {
  var ss = ss_();
  Object.keys(TABS).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    var headers = TABS[name];
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
  });
  if (readTable_('Settings').length === 0) {
    DEFAULT_SETTINGS.forEach(function (r) { appendObj_('Settings', { Key: r[0], Value: r[1], Notes: r[2] }); });
  } else {
    var have = {};
    readTable_('Settings').forEach(function (r) { have[r.Key] = true; });
    DEFAULT_SETTINGS.forEach(function (r) { if (!have[r[0]]) appendObj_('Settings', { Key: r[0], Value: r[1], Notes: r[2] }); });
  }
  if (readTable_('Users').length === 0) {
    appendObj_('Users', { Name: 'Admin', Role: 'Admin', PIN: '1234', Active: 'Yes' });
  }
  if (readTable_('Categories').length === 0) {
    DEFAULT_CATEGORIES.forEach(function (c) {
      var o = {}; TABS.Categories.forEach(function (h, i) { o[h] = c[i]; });
      appendObj_('Categories', o);
    });
  }
  var s1 = ss.getSheetByName('Sheet1');
  if (s1 && ss.getSheets().length > 1 && s1.getLastRow() === 0) ss.deleteSheet(s1);
  screenshotFolder_();
  return 'Setup complete';
}

/* ======================= SHEET HELPERS ======================= */

function ss_() { return SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet(); }

function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('Tab "' + name + '" is missing. Run setup() once from the script editor.');
  return sh;
}

function readTable_(name) {
  var sh = sheet_(name);
  var last = sh.getLastRow();
  var headers = TABS[name];
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, headers.length).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    var row = vals[i];
    var empty = true;
    var o = { _row: i + 2 };
    for (var j = 0; j < headers.length; j++) {
      var v = row[j];
      if (v instanceof Date) v = fmtDate_(v, headers[j] === 'Time' ? 'HH:mm' : (headers[j] === 'Date' ? 'yyyy-MM-dd' : 'yyyy-MM-dd HH:mm'));
      if (v !== '' && v !== null) empty = false;
      o[headers[j]] = v;
    }
    if (!empty) out.push(o);
  }
  return out;
}

function cell_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  v = String(v);
  return v === '' ? '' : "'" + v; // force text so "4-1" never becomes a date
}

function rowArr_(name, obj) { return TABS[name].map(function (h) { return cell_(obj[h]); }); }

function appendObj_(name, obj) { sheet_(name).appendRow(rowArr_(name, obj)); }

function appendMany_(name, objs) {
  if (!objs.length) return;
  var sh = sheet_(name);
  var start = Math.max(sh.getLastRow(), 1) + 1;
  sh.getRange(start, 1, objs.length, TABS[name].length).setValues(objs.map(function (o) { return rowArr_(name, o); }));
}

function updateObj_(name, obj) {
  if (!obj._row) throw new Error('Row not found');
  sheet_(name).getRange(obj._row, 1, 1, TABS[name].length).setValues([rowArr_(name, obj)]);
}

function writeAll_(name, objs) {
  // rewrite whole table body (used for bulk updates)
  var sh = sheet_(name);
  var last = sh.getLastRow();
  var n = TABS[name].length;
  if (last > 1) sh.getRange(2, 1, last - 1, n).clearContent();
  if (objs.length) sh.getRange(2, 1, objs.length, n).setValues(objs.map(function (o) { return rowArr_(name, o); }));
}

function deleteRows_(name, rows) {
  var sh = sheet_(name);
  rows.sort(function (a, b) { return b - a; }).forEach(function (r) { sh.deleteRow(r); });
}

function settings_() {
  var s = {};
  readTable_('Settings').forEach(function (r) { s[r.Key] = String(r.Value); });
  return s;
}

function log_(user, action, details) {
  try { appendObj_('Log', { Timestamp: now_(), User: user ? user.name : 'Public', Action: action, Details: details || '' }); } catch (e) {}
}

function tz_() { return Session.getScriptTimeZone() || 'Asia/Kolkata'; }
function fmtDate_(d, f) { return Utilities.formatDate(d, tz_(), f); }
function now_() { return fmtDate_(new Date(), 'yyyy-MM-dd HH:mm'); }
function id_(prefix) { return prefix + Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase(); }
function phone_(p) { var d = String(p || '').replace(/\D/g, ''); return d.length > 10 ? d.slice(-10) : d; }
function str_(v) { return String(v === null || v === undefined ? '' : v).trim(); }
function num_(v) { var n = Number(v); return isNaN(n) ? 0 : n; }
function yes_(v) { return /^(y|yes|true|1)$/i.test(str_(v)); }

/* ======================= AUTH ======================= */

function login_(name, pin) {
  var users = readTable_('Users').filter(function (u) {
    return str_(u.Name).toLowerCase() === str_(name).toLowerCase() && str_(u.PIN) === str_(pin) && yes_(u.Active);
  });
  if (!users.length) throw new Error('Wrong name or PIN.');
  var u = users[0];
  var role = ['Admin', 'Organiser', 'Scorer'].indexOf(str_(u.Role)) >= 0 ? str_(u.Role) : 'Scorer';
  var token = Utilities.getUuid();
  CacheService.getScriptCache().put('tok_' + token, JSON.stringify({ name: str_(u.Name), role: role }), SESSION_HOURS * 3600);
  log_({ name: str_(u.Name) }, 'login', role);
  return { token: token, name: str_(u.Name), role: role };
}

function checkToken_(token) {
  if (!token) return null;
  var v = CacheService.getScriptCache().get('tok_' + token);
  return v ? JSON.parse(v) : null;
}

/* ======================= READ MODELS ======================= */

function entryName_(e) {
  if (!e) return '';
  return str_(e.Player2) ? str_(e.Player1) + ' / ' + str_(e.Player2) : str_(e.Player1);
}

function entryTower_(e) {
  if (!e) return '';
  var t = [str_(e.P1Tower)];
  if (str_(e.Player2) && str_(e.P2Tower) && str_(e.P2Tower) !== str_(e.P1Tower)) t.push(str_(e.P2Tower));
  return t.filter(String).join(' / ');
}

function publicEntry_(e) {
  return { id: e.EntryID, cat: e.CategoryID, name: entryName_(e), tower: entryTower_(e), seed: e.Seed, group: e.Group };
}

function cleanMatch_(m) {
  var o = {}; TABS.Matches.forEach(function (h) { o[h] = m[h]; }); return o;
}

function publicSettings_(s) {
  return {
    TournamentName: s.TournamentName, Tagline: s.Tagline, Venue: s.Venue, Dates: s.Dates, About: s.About,
    RegistrationOpen: yes_(s.RegistrationOpen), MaxCategoriesPerPlayer: num_(s.MaxCategoriesPerPlayer) || 99,
    UPIId: s.UPIId, UPIName: s.UPIName, PaymentNote: s.PaymentNote, ContactName: s.ContactName,
    ContactPhone: s.ContactPhone, Rules: s.Rules
  };
}

function publicData_() {
  var s = settings_();
  var cats = readTable_('Categories').map(cleanCat_);
  var entries = readTable_('Entries');
  var counts = {};
  entries.forEach(function (e) { if (str_(e.Status) !== 'Withdrawn') counts[e.CategoryID] = (counts[e.CategoryID] || 0) + 1; });
  cats.forEach(function (c) { c.Entries = counts[c.CategoryID] || 0; });
  var approved = entries.filter(function (e) { return e.PaymentStatus === 'Approved' && str_(e.Status) !== 'Withdrawn'; });
  return {
    settings: publicSettings_(s),
    categories: cats,
    entries: approved.map(publicEntry_),
    matches: readTable_('Matches').map(cleanMatch_)
  };
}

function cleanCat_(c) { var o = {}; TABS.Categories.forEach(function (h) { o[h] = c[h]; }); return o; }

function cleanEntry_(e) { var o = {}; TABS.Entries.forEach(function (h) { o[h] = e[h]; }); return o; }

function lookup_(phone) {
  var ph = phone_(phone);
  if (ph.length < 10) throw new Error('Enter your 10-digit mobile number.');
  var mine = readTable_('Entries').filter(function (e) { return phone_(e.P1Phone) === ph || phone_(e.P2Phone) === ph; });
  return {
    entries: mine.map(function (e) {
      return { id: e.EntryID, reg: e.RegID, cat: e.CategoryID, name: entryName_(e), fee: e.Fee, mode: e.PaymentMode,
               payment: e.PaymentStatus, status: e.Status || 'Active', time: e.Timestamp };
    })
  };
}

function scorerData_() {
  var entries = readTable_('Entries');
  return {
    settings: publicSettings_(settings_()),
    categories: readTable_('Categories').map(cleanCat_),
    entries: entries.map(publicEntry_),
    matches: readTable_('Matches').map(cleanMatch_)
  };
}

function adminData_(u) {
  var s = settings_();
  return {
    me: u,
    settingsRaw: readTable_('Settings').map(function (r) { return { Key: r.Key, Value: String(r.Value), Notes: r.Notes }; }),
    settings: publicSettings_(s),
    play: { PlayDays: s.PlayDays, Courts: num_(s.Courts) || 1, DefaultSlotMinutes: num_(s.DefaultSlotMinutes) || 40, RestMinutes: num_(s.RestMinutes) },
    heads: { income: splitList_(s.IncomeHeads), expense: splitList_(s.ExpenseHeads) },
    categories: readTable_('Categories').map(cleanCat_),
    entries: readTable_('Entries').map(cleanEntry_),
    matches: readTable_('Matches').map(cleanMatch_),
    accounts: readTable_('Accounts').map(function (t) { var o = {}; TABS.Accounts.forEach(function (h) { o[h] = t[h]; }); return o; }),
    users: u.role === 'Admin' ? readTable_('Users').map(function (x) { return { Name: x.Name, Role: x.Role, PIN: x.PIN, Active: x.Active }; }) : [],
    sheetUrl: ss_().getUrl(),
    sheetId: ss_().getId()
  };
}

function splitList_(s) { return str_(s).split(',').map(function (x) { return x.trim(); }).filter(String); }

/* ======================= REGISTRATION ======================= */

function register_(p) {
  var s = settings_();
  if (!yes_(s.RegistrationOpen)) throw new Error('Registrations are closed.');
  return createEntries_(p, null);
}

function createEntries_(p, user) {
  var s = settings_();
  var p1 = p.player || {};
  if (!str_(p1.name)) throw new Error('Please enter your name.');
  var ph1 = phone_(p1.phone);
  if (ph1.length !== 10) throw new Error('Please enter a valid 10-digit mobile number.');
  if (!str_(p1.tower)) throw new Error('Please select your tower.');
  var picks = p.categories || [];
  if (!picks.length) throw new Error('Please choose at least one category.');

  var cats = {};
  readTable_('Categories').forEach(function (c) { cats[c.CategoryID] = c; });
  var entries = readTable_('Entries').filter(function (e) { return str_(e.Status) !== 'Withdrawn'; });
  var maxCats = num_(s.MaxCategoriesPerPlayer) || 99;

  var existingForPhone = function (ph) {
    return entries.filter(function (e) { return phone_(e.P1Phone) === ph || phone_(e.P2Phone) === ph; });
  };
  if (!user && existingForPhone(ph1).length + picks.length > maxCats) {
    throw new Error('Each player can enter at most ' + maxCats + ' categories. You already have ' + existingForPhone(ph1).length + '.');
  }

  var regId = id_('R');
  var ts = now_();
  var rows = [];
  var total = 0;
  var seen = {};
  picks.forEach(function (pk) {
    var c = cats[pk.catId];
    if (!c) throw new Error('Unknown category.');
    if (seen[pk.catId]) throw new Error('Category chosen twice: ' + c.Name);
    seen[pk.catId] = true;
    if (!user && str_(c.Status) !== 'Open') throw new Error(c.Name + ' is closed for entries.');
    var inCat = entries.filter(function (e) { return e.CategoryID === c.CategoryID; });
    var max = num_(c.MaxEntries);
    if (max && inCat.length >= max && !user) throw new Error(c.Name + ' is full (' + max + ' entries).');
    var dup = inCat.filter(function (e) { return phone_(e.P1Phone) === ph1 || phone_(e.P2Phone) === ph1; });
    if (dup.length) throw new Error('You are already entered in ' + c.Name + ' (' + entryName_(dup[0]) + ').');
    var partner = pk.partner || {};
    var ph2 = '';
    if (str_(c.Type) === 'Doubles') {
      if (!str_(partner.name)) throw new Error('Please enter your partner\'s name for ' + c.Name + '.');
      ph2 = phone_(partner.phone);
      if (ph2 && ph2.length !== 10) throw new Error('Partner\'s mobile number for ' + c.Name + ' looks wrong.');
      if (ph2 && ph2 === ph1) throw new Error('Partner\'s number cannot be the same as yours.');
      if (ph2) {
        var dup2 = inCat.filter(function (e) { return phone_(e.P1Phone) === ph2 || phone_(e.P2Phone) === ph2; });
        if (dup2.length) throw new Error(str_(partner.name) + ' is already entered in ' + c.Name + ' (' + entryName_(dup2[0]) + ').');
      }
    }
    var fee = num_(c.Fee);
    total += fee;
    rows.push({
      EntryID: id_('E'), RegID: regId, Timestamp: ts, CategoryID: c.CategoryID,
      Player1: str_(p1.name), P1Tower: str_(p1.tower), P1Flat: str_(p1.flat), P1Phone: ph1,
      Player2: str_(c.Type) === 'Doubles' ? str_(partner.name) : '',
      P2Tower: str_(c.Type) === 'Doubles' ? str_(partner.tower) : '',
      P2Flat: str_(c.Type) === 'Doubles' ? str_(partner.flat) : '',
      P2Phone: ph2,
      LastTournament: str_(p.last && p.last.tournament), LastCategory: str_(p.last && p.last.category),
      LastResult: str_(p.last && p.last.result),
      Fee: fee, PaymentMode: p.paymentMode === 'Cash' ? 'Cash' : 'UPI', PaymentRef: str_(p.paymentRef),
      ScreenshotID: '', PaymentStatus: 'Pending', ApprovedBy: '', ApprovedAt: '', Seed: '', Group: '',
      Status: 'Active', Remarks: str_(p.remarks)
    });
  });

  if (p.paymentMode !== 'Cash' && !user) {
    if (!p.screenshot || !p.screenshot.data) throw new Error('Please upload the payment screenshot (or choose Cash).');
  }
  var shotId = '';
  if (p.screenshot && p.screenshot.data) {
    var bytes = Utilities.base64Decode(String(p.screenshot.data).replace(/^data:[^,]+,/, ''));
    if (bytes.length > 4 * 1024 * 1024) throw new Error('Screenshot is too large (max 4 MB).');
    var blob = Utilities.newBlob(bytes, p.screenshot.mime || 'image/jpeg', regId + '_' + str_(p1.name).replace(/\W+/g, '_') + '.jpg');
    shotId = screenshotFolder_().createFile(blob).getId();
  }
  rows.forEach(function (r) {
    r.ScreenshotID = shotId;
    if (user && p.approveNow) { r.PaymentStatus = 'Approved'; r.ApprovedBy = user.name; r.ApprovedAt = ts; }
  });
  appendMany_('Entries', rows);
  log_(user, 'register', regId + ' ' + str_(p1.name) + ' ' + rows.map(function (r) { return r.CategoryID; }).join(','));
  return { regId: regId, total: total, count: rows.length };
}

function screenshotFolder_() {
  var it = DriveApp.getFoldersByName(SCREENSHOT_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(SCREENSHOT_FOLDER);
}

function getScreenshot_(id) {
  if (!id) throw new Error('No screenshot');
  var b = DriveApp.getFileById(id).getBlob();
  return 'data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes());
}

/* ======================= ENTRIES (ADMIN) ======================= */

function setPayment_(p, u) {
  var status = ['Approved', 'Pending', 'Rejected'].indexOf(p.status) >= 0 ? p.status : 'Approved';
  var rows = readTable_('Entries').filter(function (e) { return p.regId ? e.RegID === p.regId : e.EntryID === p.entryId; });
  if (!rows.length) throw new Error('Entry not found');
  rows.forEach(function (e) {
    e.PaymentStatus = status;
    if (p.mode) e.PaymentMode = p.mode;
    e.ApprovedBy = status === 'Pending' ? '' : u.name;
    e.ApprovedAt = status === 'Pending' ? '' : now_();
    updateObj_('Entries', e);
  });
  log_(u, 'payment ' + status, (p.regId || p.entryId) + ' x' + rows.length);
  return rows.length;
}

function updateEntry_(p, u) {
  var e = readTable_('Entries').filter(function (x) { return x.EntryID === p.EntryID; })[0];
  if (!e) throw new Error('Entry not found');
  ['Player1', 'P1Tower', 'P1Flat', 'P1Phone', 'Player2', 'P2Tower', 'P2Flat', 'P2Phone', 'LastTournament',
   'LastCategory', 'LastResult', 'Fee', 'PaymentMode', 'PaymentRef', 'Seed', 'Group', 'Status', 'Remarks', 'CategoryID'
  ].forEach(function (k) { if (p[k] !== undefined) e[k] = p[k]; });
  e.P1Phone = phone_(e.P1Phone); e.P2Phone = phone_(e.P2Phone);
  e.Fee = num_(e.Fee);
  e.Seed = str_(e.Seed) === '' ? '' : num_(e.Seed);
  updateObj_('Entries', e);
  log_(u, 'edit entry', e.EntryID);
  return true;
}

function addEntryAdmin_(p, u) { return createEntries_(p, u); }

function deleteEntry_(p, u) {
  var used = readTable_('Matches').some(function (m) { return m.SideA === p.EntryID || m.SideB === p.EntryID; });
  if (used) throw new Error('This entry is already in a draw. Mark it Withdrawn instead, or clear the draw first.');
  var e = readTable_('Entries').filter(function (x) { return x.EntryID === p.EntryID; })[0];
  if (!e) throw new Error('Entry not found');
  deleteRows_('Entries', [e._row]);
  log_(u, 'delete entry', p.EntryID + ' ' + entryName_(e));
  return true;
}

/* ======================= CATEGORIES ======================= */

function saveCategory_(p, u) {
  var cats = readTable_('Categories');
  var id = str_(p.CategoryID).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!id) throw new Error('Category code is required (e.g. MS).');
  if (!str_(p.Name)) throw new Error('Category name is required.');
  var c = cats.filter(function (x) { return x.CategoryID === id; })[0];
  var o = c || {};
  o.CategoryID = id; o.Name = str_(p.Name);
  o.Type = p.Type === 'Doubles' ? 'Doubles' : 'Singles';
  o.Format = p.Format === 'Round Robin' ? 'Round Robin' : 'Knockout';
  o.Groups = Math.max(1, num_(p.Groups) || 1);
  o.Fee = num_(p.Fee); o.MaxEntries = num_(p.MaxEntries) || '';
  o.SlotMinutes = num_(p.SlotMinutes) || '';
  o.Status = p.Status === 'Closed' ? 'Closed' : 'Open';
  o.Order = num_(p.Order) || cats.length + 1; o.Notes = str_(p.Notes);
  if (c) updateObj_('Categories', o); else appendObj_('Categories', o);
  log_(u, c ? 'edit category' : 'add category', id);
  return true;
}

function deleteCategory_(p, u) {
  var hasEntries = readTable_('Entries').some(function (e) { return e.CategoryID === p.CategoryID; });
  if (hasEntries) throw new Error('This category has entries. Close it instead of deleting.');
  var c = readTable_('Categories').filter(function (x) { return x.CategoryID === p.CategoryID; })[0];
  if (!c) throw new Error('Category not found');
  deleteRows_('Categories', [c._row]);
  log_(u, 'delete category', p.CategoryID);
  return true;
}

/* ======================= DRAWS ======================= */

function bracketOrder_(size) {
  var order = [1, 2];
  while (order.length < size) {
    var n = order.length * 2, next = [];
    order.forEach(function (s) { next.push(s); next.push(n + 1 - s); });
    order = next;
  }
  return order;
}

function koRoundName_(matchesInRound) {
  if (matchesInRound === 1) return 'Final';
  if (matchesInRound === 2) return 'Semi-final';
  if (matchesInRound === 4) return 'Quarter-final';
  return 'Round of ' + (matchesInRound * 2);
}

function shuffle_(a) {
  for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}

function orderedEntries_(list) {
  var seeded = list.filter(function (e) { return str_(e.Seed) !== '' && num_(e.Seed) > 0; })
                   .sort(function (a, b) { return num_(a.Seed) - num_(b.Seed); });
  var unseeded = shuffle_(list.filter(function (e) { return !(str_(e.Seed) !== '' && num_(e.Seed) > 0); }));
  return seeded.concat(unseeded);
}

function generateDraw_(p, u) {
  var cat = readTable_('Categories').filter(function (c) { return c.CategoryID === p.CategoryID; })[0];
  if (!cat) throw new Error('Category not found');
  var existing = readTable_('Matches').filter(function (m) { return m.CategoryID === cat.CategoryID; });
  if (existing.length) throw new Error('A draw already exists for ' + cat.Name + '. Clear it first.');
  var list = readTable_('Entries').filter(function (e) {
    return e.CategoryID === cat.CategoryID && e.PaymentStatus === 'Approved' && str_(e.Status) !== 'Withdrawn';
  });
  if (list.length < 2) throw new Error('Need at least 2 approved entries in ' + cat.Name + ' (found ' + list.length + ').');
  var ordered = orderedEntries_(list);
  var format = p.Format || cat.Format;
  var offset = maxMatchNo_();   // match numbers are unique across the whole tournament
  var matches = format === 'Round Robin' ? buildRR_(cat, ordered, num_(p.Groups) || num_(cat.Groups) || 1, offset)
                                         : buildKO_(cat, ordered, offset);
  appendMany_('Matches', matches);
  log_(u, 'generate draw', cat.CategoryID + ' ' + format + ' ' + list.length + ' entries, ' + matches.length + ' matches');
  return { matches: matches.length, entries: list.length };
}

function maxMatchNo_() {
  return readTable_('Matches').reduce(function (mx, m) { return Math.max(mx, num_(m.MatchNo)); }, 0);
}

function buildKO_(cat, ordered, offset) {
  var n = ordered.length;
  var size = 1; while (size < n) size *= 2;
  var order = bracketOrder_(size);
  var slots = order.map(function (seedNo) { return seedNo <= n ? ordered[seedNo - 1].EntryID : 'BYE'; });
  var rounds = Math.log(size) / Math.LN2;
  var all = [], byRound = [], no = offset || 0;
  for (var r = 1; r <= rounds; r++) {
    var count = size / Math.pow(2, r), arr = [];
    for (var k = 1; k <= count; k++) {
      no++;
      arr.push({
        MatchID: cat.CategoryID + '-R' + r + '-' + k, CategoryID: cat.CategoryID, Stage: 'KO',
        Round: koRoundName_(count), RoundNo: r, Group: '', MatchNo: no, SideA: '', SideB: '',
        NextMatch: r < rounds ? cat.CategoryID + '-R' + (r + 1) + '-' + Math.ceil(k / 2) : '',
        NextSlot: r < rounds ? (k % 2 === 1 ? 'A' : 'B') : '',
        Date: '', Time: '', Court: '', Score: '', Winner: '', Result: 'Pending', EnteredBy: '', EnteredAt: '', Notes: ''
      });
    }
    byRound.push(arr); all = all.concat(arr);
  }
  var index = {}; all.forEach(function (m) { index[m.MatchID] = m; });
  byRound[0].forEach(function (m, i) { m.SideA = slots[2 * i]; m.SideB = slots[2 * i + 1]; });
  byRound[0].forEach(function (m) {
    if (m.SideA === 'BYE' || m.SideB === 'BYE') {
      m.Winner = m.SideA === 'BYE' ? m.SideB : m.SideA;
      m.Result = 'Bye'; m.Score = 'Bye';
      advance_(index, m);
    }
  });
  return all;
}

function advance_(index, m) {
  if (!m.NextMatch) return;
  var nx = index[m.NextMatch];
  if (!nx) return;
  if (m.NextSlot === 'A') nx.SideA = m.Winner || ''; else nx.SideB = m.Winner || '';
}

function buildRR_(cat, ordered, groups, offset) {
  groups = Math.max(1, Math.min(groups, Math.floor(ordered.length / 2)));
  var buckets = []; for (var g = 0; g < groups; g++) buckets.push([]);
  ordered.forEach(function (e, i) {               // snake seeding
    var row = Math.floor(i / groups), pos = i % groups;
    buckets[row % 2 === 0 ? pos : groups - 1 - pos].push(e.EntryID);
  });
  var letters = 'ABCDEFGHIJ';
  var all = [], no = offset || 0;
  buckets.forEach(function (ids, gi) {
    var gname = groups > 1 ? letters.charAt(gi) : '';
    var list = ids.slice(); if (list.length % 2) list.push('BYE');
    var n = list.length;
    for (var r = 0; r < n - 1; r++) {
      for (var i = 0; i < n / 2; i++) {
        var a = list[i], b = list[n - 1 - i];
        if (a === 'BYE' || b === 'BYE') continue;
        no++;
        all.push({
          MatchID: cat.CategoryID + '-' + (gname || 'G') + '-' + (r + 1) + '-' + (i + 1), CategoryID: cat.CategoryID, Stage: 'RR',
          Round: (gname ? 'Group ' + gname + ' · ' : '') + 'Round ' + (r + 1), RoundNo: r + 1, Group: gname, MatchNo: no,
          SideA: a, SideB: b, NextMatch: '', NextSlot: '', Date: '', Time: '', Court: '', Score: '', Winner: '',
          Result: 'Pending', EnteredBy: '', EnteredAt: '', Notes: ''
        });
      }
      list.splice(1, 0, list.pop());               // circle method
    }
  });
  // record group on entries
  var eRows = readTable_('Entries');
  buckets.forEach(function (ids, gi) {
    ids.forEach(function (id) {
      var e = eRows.filter(function (x) { return x.EntryID === id; })[0];
      if (e) { e.Group = groups > 1 ? letters.charAt(gi) : ''; updateObj_('Entries', e); }
    });
  });
  return all;
}

function clearDraw_(p, u) {
  var ms = readTable_('Matches').filter(function (m) { return m.CategoryID === p.CategoryID; });
  var played = ms.filter(function (m) { return m.Result !== 'Pending' && m.Result !== 'Bye'; });
  if (played.length && !p.force) throw new Error(played.length + ' match(es) already have results. Tick "force" to clear anyway.');
  deleteRows_('Matches', ms.map(function (m) { return m._row; }));
  log_(u, 'clear draw', p.CategoryID + ' (' + ms.length + ' matches)');
  return ms.length;
}

/* ======================= SCORES ======================= */

function saveScore_(p, u) {
  var all = readTable_('Matches');
  var index = {}; all.forEach(function (m) { index[m.MatchID] = m; });
  var m = index[p.MatchID];
  if (!m) throw new Error('Match not found');
  if (!m.SideA || !m.SideB || m.SideA === 'BYE' || m.SideB === 'BYE') throw new Error('Both players are not known yet for this match.');
  var result = ['Completed', 'Walkover', 'Retired'].indexOf(p.Result) >= 0 ? p.Result : 'Completed';
  var winner = p.Winner === 'A' ? m.SideA : p.Winner === 'B' ? m.SideB : '';
  if (!winner) throw new Error('Please choose the winner.');
  var score = str_(p.Score);
  if (result === 'Walkover' && !score) score = 'W/O';
  if (!score) throw new Error('Please enter the score (e.g. 4-1, 6-4 3-6 10-7).');
  var oldWinner = m.Winner;
  if (m.NextMatch && oldWinner && oldWinner !== winner) {
    var nx = index[m.NextMatch];
    if (nx && nx.Result !== 'Pending') throw new Error('The next-round match is already played. Clear that score first.');
  }
  m.Winner = winner; m.Score = score; m.Result = result;
  m.EnteredBy = u.name; m.EnteredAt = now_();
  if (p.Notes !== undefined) m.Notes = str_(p.Notes);
  updateObj_('Matches', m);
  if (m.NextMatch && index[m.NextMatch]) {
    advance_(index, m);
    updateObj_('Matches', index[m.NextMatch]);
  }
  log_(u, 'score', m.MatchID + ' ' + score + ' winner ' + winner);
  return true;
}

function clearScore_(p, u) {
  var all = readTable_('Matches');
  var index = {}; all.forEach(function (m) { index[m.MatchID] = m; });
  var m = index[p.MatchID];
  if (!m) throw new Error('Match not found');
  if (m.NextMatch && index[m.NextMatch]) {
    var nx = index[m.NextMatch];
    if (nx.Result !== 'Pending') throw new Error('The next-round match is already played. Clear that score first.');
    if (m.NextSlot === 'A') nx.SideA = ''; else nx.SideB = '';
    updateObj_('Matches', nx);
  }
  m.Winner = ''; m.Score = ''; m.Result = 'Pending'; m.EnteredBy = u.name; m.EnteredAt = now_();
  updateObj_('Matches', m);
  log_(u, 'clear score', m.MatchID);
  return true;
}

function editMatch_(p, u) {
  var m = readTable_('Matches').filter(function (x) { return x.MatchID === p.MatchID; })[0];
  if (!m) throw new Error('Match not found');
  ['Date', 'Time', 'Court', 'Round', 'Notes', 'SideA', 'SideB'].forEach(function (k) { if (p[k] !== undefined) m[k] = str_(p[k]); });
  updateObj_('Matches', m);
  log_(u, 'edit match', m.MatchID);
  return true;
}

function addMatch_(p, u) {
  if (!p.CategoryID) throw new Error('Choose a category');
  var ms = readTable_('Matches');
  var no = ms.reduce(function (mx, m) { return Math.max(mx, num_(m.MatchNo)); }, 0) + 1;
  var o = {
    MatchID: p.CategoryID + '-X' + no + '-' + Utilities.getUuid().slice(0, 4).toUpperCase(), CategoryID: p.CategoryID, Stage: 'Manual',
    Round: str_(p.Round) || 'Play-off', RoundNo: num_(p.RoundNo) || 99, Group: '', MatchNo: no,
    SideA: str_(p.SideA), SideB: str_(p.SideB), NextMatch: '', NextSlot: '', Date: str_(p.Date), Time: str_(p.Time),
    Court: str_(p.Court), Score: '', Winner: '', Result: 'Pending', EnteredBy: '', EnteredAt: '', Notes: str_(p.Notes)
  };
  appendObj_('Matches', o);
  log_(u, 'add match', o.MatchID);
  return o.MatchID;
}

function deleteMatch_(p, u) {
  var all = readTable_('Matches');
  var m = all.filter(function (x) { return x.MatchID === p.MatchID; })[0];
  if (!m) throw new Error('Match not found');
  var feeds = all.some(function (x) { return x.NextMatch === m.MatchID; });
  if (m.Stage === 'KO' || feeds) throw new Error('Knockout matches are linked. Clear the whole draw instead.');
  deleteRows_('Matches', [m._row]);
  log_(u, 'delete match', m.MatchID);
  return true;
}

/* ======================= SCHEDULE ======================= */

function parseDays_(text) {
  var days = [];
  str_(text).split(/\n|;/).forEach(function (line) {
    var mm = line.trim().match(/^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
    if (mm) days.push({ date: mm[1], start: +mm[2] * 60 + +mm[3], end: +mm[4] * 60 + +mm[5] });
  });
  days.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.start - b.start; });
  return days;
}

function hhmm_(mins) { var h = Math.floor(mins / 60), m = mins % 60; return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m; }

function autoSchedule_(p, u) {
  var s = settings_();
  var days = parseDays_(s.PlayDays);
  if (!days.length) throw new Error('Add play days in Settings (e.g. 2026-11-07 07:00-19:00).');
  var courts = Math.max(1, num_(s.Courts) || 1);
  var defMin = num_(s.DefaultSlotMinutes) || 40;
  var rest = num_(s.RestMinutes);
  var cats = {}; readTable_('Categories').forEach(function (c) { cats[c.CategoryID] = c; });
  var entries = {}; readTable_('Entries').forEach(function (e) { entries[e.EntryID] = e; });
  var all = readTable_('Matches');
  var onlyCats = p.categories && p.categories.length ? p.categories : null;
  var startDay = 0, startMin = days[0].start;
  if (p.fromDate) {
    for (var d0 = 0; d0 < days.length; d0++) if (days[d0].date >= p.fromDate) { startDay = d0; break; }
    startMin = days[startDay].start;
    if (p.fromTime && days[startDay].date === p.fromDate) {
      var t = p.fromTime.split(':'); startMin = Math.max(days[startDay].start, +t[0] * 60 + +t[1]);
    }
  }
  var abs = function (dayIdx, min) { return dayIdx * 1440 + min; };
  var dur = function (m) { return num_(cats[m.CategoryID] && cats[m.CategoryID].SlotMinutes) || defMin; };
  var phones = function (sideId) {
    var e = entries[sideId]; if (!e) return [];
    return [phone_(e.P1Phone), phone_(e.P2Phone)].filter(String);
  };
  var feeders = {}; all.forEach(function (m) { if (m.NextMatch) (feeders[m.NextMatch] = feeders[m.NextMatch] || []).push(m); });

  var todo = all.filter(function (m) {
    return m.Result === 'Pending' && (!onlyCats || onlyCats.indexOf(m.CategoryID) >= 0) &&
           !(p.keepManual && m.Date);
  });
  var todoIds = {}; todo.forEach(function (m) { todoIds[m.MatchID] = true; });
  var finishAt = {};   // MatchID -> abs end time (for scheduled / fixed matches)
  var playerFree = {}; // phone -> abs time free
  // fixed matches (already scheduled and not being moved) block the court and players
  var courtBusy = [];  // {court, s, e}
  all.forEach(function (m) {
    if (todoIds[m.MatchID] || !m.Date || !m.Time) return;
    var di = -1; days.forEach(function (d, i) { if (d.date === m.Date && di < 0) di = i; });
    if (di < 0) return;
    var tt = String(m.Time).split(':'); var st = abs(di, +tt[0] * 60 + +tt[1]); var en = st + dur(m);
    finishAt[m.MatchID] = en;
    if (m.Result === 'Pending') courtBusy.push({ court: str_(m.Court) || '1', s: st, e: en });
    phones(m.SideA).concat(phones(m.SideB)).forEach(function (ph) { playerFree[ph] = Math.max(playerFree[ph] || 0, en + rest); });
  });
  all.forEach(function (m) { if (m.Result === 'Bye') finishAt[m.MatchID] = -1; });

  var catOrder = function (id) { return num_(cats[id] && cats[id].Order) || 99; };
  var prio = function (m) { return m.Round === 'Final' ? 2 : m.Round === 'Semi-final' ? 1 : 0; };
  todo.sort(function (a, b) {
    return prio(a) - prio(b) || num_(a.RoundNo) - num_(b.RoundNo) || catOrder(a.CategoryID) - catOrder(b.CategoryID) ||
           num_(a.MatchNo) - num_(b.MatchNo);
  });

  var courtFree = []; for (var c = 0; c < courts; c++) courtFree.push(abs(startDay, startMin));
  var dayOf = function (t) { return Math.floor(t / 1440); };
  var fit = function (t, len) { // move t into a play window that can hold len minutes
    var di = Math.max(dayOf(t), startDay);
    if (t < abs(di, 0)) t = abs(di, 0);
    while (di < days.length) {
      var ds = abs(di, days[di].start), de = abs(di, days[di].end);
      if (t < ds) t = ds;
      if (t + len <= de) return t;
      di++; t = di < days.length ? abs(di, days[di].start) : Infinity;
    }
    return Infinity;
  };
  var clashCourt = function (ci, st, en) {
    return courtBusy.some(function (b) { return b.court === String(ci + 1) && st < b.e && en > b.s; });
  };
  var earliest = function (m, courtT, ci) {
    var t = courtT, len = dur(m);
    var fs = feeders[m.MatchID] || [];
    for (var i = 0; i < fs.length; i++) {
      var f = fs[i];
      if (f.Result !== 'Pending') continue;                // already decided
      if (finishAt[f.MatchID] === undefined) return Infinity; // feeder not scheduled yet
      t = Math.max(t, finishAt[f.MatchID] + rest);
    }
    phones(m.SideA).concat(phones(m.SideB)).forEach(function (ph) { if (playerFree[ph]) t = Math.max(t, playerFree[ph]); });
    // feeder players (TBD side) – they also need rest; covered by feeder finish + rest
    for (var guard = 0; guard < 200; guard++) {
      t = fit(t, len);
      if (t === Infinity) return Infinity;
      if (!clashCourt(ci, t, t + len)) return t;
      var blocking = courtBusy.filter(function (b) { return b.court === String(ci + 1) && t < b.e && t + len > b.s; });
      t = Math.max.apply(null, blocking.map(function (b) { return b.e; }));
    }
    return Infinity;
  };

  var placed = 0, unplaced = [];
  var remaining = todo.slice();
  while (remaining.length) {
    var ci = 0; for (var k = 1; k < courts; k++) if (courtFree[k] < courtFree[ci]) ci = k;
    if (courtFree[ci] === Infinity) break;
    var best = null, bestT = Infinity, bestIdx = -1;
    for (var i = 0; i < remaining.length; i++) {
      var tt2 = earliest(remaining[i], courtFree[ci], ci);
      if (tt2 < bestT) { bestT = tt2; best = remaining[i]; bestIdx = i; if (tt2 === courtFree[ci]) break; }
    }
    if (!best) { courtFree[ci] = Infinity; continue; }
    var en2 = bestT + dur(best);
    best.Date = days[dayOf(bestT)].date; best.Time = hhmm_(bestT % 1440); best.Court = String(ci + 1);
    finishAt[best.MatchID] = en2;
    courtFree[ci] = en2;
    phones(best.SideA).concat(phones(best.SideB)).forEach(function (ph) { playerFree[ph] = en2 + rest; });
    remaining.splice(bestIdx, 1);
    placed++;
  }
  remaining.forEach(function (m) { m.Date = ''; m.Time = ''; m.Court = ''; unplaced.push(m.MatchID); });
  todo.forEach(function (m) { updateObj_('Matches', m); });
  log_(u, 'auto schedule', placed + ' placed, ' + unplaced.length + ' not placed');
  return { placed: placed, unplaced: unplaced.length };
}

/* ======================= ACCOUNTS ======================= */

function saveTxn_(p, u) {
  var amt = num_(p.Amount);
  if (amt <= 0) throw new Error('Amount must be more than 0.');
  if (!str_(p.Head)) throw new Error('Choose a head.');
  var o = {
    TxnID: p.TxnID || id_('T'), Date: str_(p.Date) || now_().slice(0, 10), Type: p.Type === 'Income' ? 'Income' : 'Expense',
    Head: str_(p.Head), Description: str_(p.Description), Amount: amt, Mode: str_(p.Mode), Party: str_(p.Party),
    Reference: str_(p.Reference), EnteredBy: u.name, EnteredAt: now_()
  };
  if (p.TxnID) {
    var t = readTable_('Accounts').filter(function (x) { return x.TxnID === p.TxnID; })[0];
    if (!t) throw new Error('Transaction not found');
    o._row = t._row; updateObj_('Accounts', o);
  } else appendObj_('Accounts', o);
  log_(u, 'txn', o.Type + ' ' + o.Head + ' ' + amt);
  return o.TxnID;
}

function deleteTxn_(p, u) {
  var t = readTable_('Accounts').filter(function (x) { return x.TxnID === p.TxnID; })[0];
  if (!t) throw new Error('Transaction not found');
  deleteRows_('Accounts', [t._row]);
  log_(u, 'delete txn', p.TxnID);
  return true;
}

/* ======================= SETTINGS & USERS ======================= */

function saveSettings_(p, u) {
  var rows = readTable_('Settings');
  Object.keys(p).forEach(function (k) {
    var r = rows.filter(function (x) { return x.Key === k; })[0];
    if (r) { r.Value = p[k]; updateObj_('Settings', r); }
    else appendObj_('Settings', { Key: k, Value: p[k], Notes: '' });
  });
  log_(u, 'settings', Object.keys(p).join(','));
  return true;
}

function saveUser_(p, u) {
  if (!str_(p.Name) || !str_(p.PIN)) throw new Error('Name and PIN are required.');
  if (!/^\d{4,8}$/.test(str_(p.PIN))) throw new Error('PIN must be 4 to 8 digits.');
  var users = readTable_('Users');
  var x = users.filter(function (y) { return str_(y.Name).toLowerCase() === str_(p.Name).toLowerCase(); })[0];
  var role = ['Admin', 'Organiser', 'Scorer'].indexOf(p.Role) >= 0 ? p.Role : 'Scorer';
  var o = x || {};
  o.Name = str_(p.Name); o.Role = role; o.PIN = str_(p.PIN); o.Active = p.Active === 'No' ? 'No' : 'Yes';
  if (x) updateObj_('Users', o); else appendObj_('Users', o);
  log_(u, 'user', o.Name + ' ' + role);
  return true;
}

function deleteUser_(p, u) {
  var users = readTable_('Users');
  var x = users.filter(function (y) { return str_(y.Name).toLowerCase() === str_(p.Name).toLowerCase(); })[0];
  if (!x) throw new Error('User not found');
  var admins = users.filter(function (y) { return y.Role === 'Admin' && yes_(y.Active); });
  if (x.Role === 'Admin' && admins.length <= 1) throw new Error('You cannot remove the last Admin.');
  deleteRows_('Users', [x._row]);
  log_(u, 'delete user', x.Name);
  return true;
}
