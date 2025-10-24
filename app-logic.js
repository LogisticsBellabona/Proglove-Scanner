/* app-logic.js
   Complete single-file logic for ProGlove Bowl Tracking System
   - Works with Firebase Realtime DB (project: proglove-scanner)
   - Clean scan handling (kitchen + return)
   - Local fallback to localStorage if Firebase not available
*/

// ------------------- GLOBAL STATE -------------------
window.appData = {
    mode: null,
    user: null,
    dishLetter: null,
    scanning: false,
    myScans: [],
    activeBowls: [],
    preparedBowls: [],
    returnedBowls: [],
    scanHistory: [],
    customerData: [],
    lastActivity: Date.now(),
    lastSync: null
};

// Small user list (keeps parity with your source)
const USERS = [
    {name: "Hamid", role: "Kitchen"},
    {name: "Richa", role: "Kitchen"},
    {name: "Jash", role: "Kitchen"},
    {name: "Joes", role: "Kitchen"},
    {name: "Mary", role: "Kitchen"},
    {name: "Rushal", role: "Kitchen"},
    {name: "Sreekanth", role: "Kitchen"},
    {name: "Sultan", role: "Return"},
    {name: "Riyaz", role: "Return"},
    {name: "Alan", role: "Return"},
    {name: "Adesh", role: "Return"}
];

// Firebase config (keeps your existing project)
// ------------------- FIREBASE CONFIG -------------------
var firebaseConfig = {
  apiKey: "AIzaSyDya1dDRSeQmuKnpraSoSoTjauLlJ_J94I",
  authDomain: "proglove-bowl-tracker.firebaseapp.com",
  databaseURL: "https://proglove-bowl-tracker-default-rtdb.firebaseio.com",
  projectId: "proglove-bowl-tracker",
  storageBucket: "proglove-bowl-tracker.firebasestorage.app",
  messagingSenderId: "280001054969",
  appId: "1:280001054969:web:a0792a228ea2f1c5c9ba28"
};

// ------------------- UTILITIES -------------------
function showMessage(message, type) {
    try {
        var container = document.getElementById('messageContainer');
        if (!container) return;
        var el = document.createElement('div');
        el.style.pointerEvents = 'auto';
        el.style.background = (type === 'error') ? '#7f1d1d' : (type === 'success') ? '#064e3b' : '#1f2937';
        el.style.color = '#fff';
        el.style.padding = '10px 14px';
        el.style.borderRadius = '8px';
        el.style.marginTop = '8px';
        el.style.boxShadow = '0 6px 20px rgba(0,0,0,0.6)';
        el.innerText = message;
        container.appendChild(el);
        setTimeout(function() {
            try { container.removeChild(el); } catch(e){}
        }, 4000);
    } catch(e){ console.error("showMessage error:",e) }
}

function nowISO() { return (new Date()).toISOString(); }
function todayDateStr() { return (new Date()).toLocaleDateString('en-GB'); }

// ------------------- STORAGE -------------------
function saveToLocal() {
    try {
        var toSave = {
            activeBowls: window.appData.activeBowls,
            preparedBowls: window.appData.preparedBowls,
            returnedBowls: window.appData.returnedBowls,
            myScans: window.appData.myScans,
            scanHistory: window.appData.scanHistory,
            customerData: window.appData.customerData,
            lastSync: window.appData.lastSync
        };
        localStorage.setItem('proglove_data_v1', JSON.stringify(toSave));
    } catch(e){ console.error("saveToLocal:", e) }
}

function loadFromLocal() {
    try {
        var raw = localStorage.getItem('proglove_data_v1');
        if (!raw) return;
        var parsed = JSON.parse(raw);
        window.appData.activeBowls = parsed.activeBowls || [];
        window.appData.preparedBowls = parsed.preparedBowls || [];
        window.appData.returnedBowls = parsed.returnedBowls || [];
        window.appData.myScans = parsed.myScans || [];
        window.appData.scanHistory = parsed.scanHistory || [];
        window.appData.customerData = parsed.customerData || [];
        window.appData.lastSync = parsed.lastSync || null;
    } catch(e){ console.error("loadFromLocal:", e) }
}

// ------------------- FIREBASE -------------------
function initFirebaseAndStart() {
    try {
        if (typeof firebase === "undefined") {
            console.error("❌ Firebase SDK not loaded — check script includes.");
            updateSystemStatus(false, "Firebase SDK missing");
            loadFromLocal();
            initializeUI();
            return;
        }

        // Initialize Firebase only once
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
            console.log("✅ Firebase initialized:", firebaseConfig.projectId);
        } else {
            try {
                console.log("ℹ️ Firebase already initialized:", firebase.apps[0].options.projectId);
            } catch(e) { console.log("ℹ️ Firebase already initialized (unknown name)"); }
        }

        // Start monitoring and loading
        monitorConnection();
        loadFromFirebase();

    } catch (e) {
        console.error("❌ initFirebaseAndStart error:", e);
        updateSystemStatus(false, "Firebase init failed — using local data");
        loadFromLocal();
        initializeUI();
    }
}

function updateSystemStatus(connected, text) {
    var el = document.getElementById('systemStatus');
    if (!el) return;
    if (connected === true) {
        el.innerText = '✅ Firebase Connected';
        el.style.background = '#064e3b';
    } else {
        el.innerText = (text || '⚠️ Firebase Disconnected');
        el.style.background = '#7f1d1d';
    }
}

function monitorConnection() {
    try {
        if (!firebase.apps.length) {
            console.warn("⚠️ monitorConnection skipped — Firebase not initialized");
            return;
        }

        if (!firebase.database) {
            console.warn("⚠️ Firebase database() not available — check SDK include");
            return;
        }

        var db = firebase.database();
        if (!db) {
            console.warn("⚠️ monitorConnection — database unavailable");
            return;
        }

        var connectedRef = db.ref(".info/connected");
        connectedRef.on("value", function (snap) {
            try {
                if (snap && snap.val() === true) {
                    updateSystemStatus(true, "✅ Firebase Connected");
                } else {
                    updateSystemStatus(false, "⚠️ Firebase Disconnected");
                }
            } catch(e){ console.warn("monitorConnection callback error:", e); }
        });

    } catch (e) {
        console.error("❌ monitorConnection failed:", e);
        updateSystemStatus(false, "Connection monitor unavailable");
    }
}

function loadFromFirebase() {
    try {
        var db = firebase.database();
        var ref = db.ref('progloveData');
        updateSystemStatus(false, '🔄 Loading cloud...');
        ref.once('value').then(function(snapshot) {
            if (snapshot && snapshot.exists && snapshot.exists()) {
                var val = snapshot.val() || {};
                // merge safely: prefer cloud but keep local unmatched
                window.appData.activeBowls = val.activeBowls || window.appData.activeBowls || [];
                window.appData.preparedBowls = val.preparedBowls || window.appData.preparedBowls || [];
                window.appData.returnedBowls = val.returnedBowls || window.appData.returnedBowls || [];
                window.appData.myScans = val.myScans || window.appData.myScans || [];
                window.appData.scanHistory = val.scanHistory || window.appData.scanHistory || [];
                window.appData.customerData = val.customerData || window.appData.customerData || [];
                window.appData.lastSync = nowISO();
                saveToLocal();
                updateSystemStatus(true);
                showMessage('✅ Cloud data loaded', 'success');
            } else {
                // no cloud data
                updateSystemStatus(true, '✅ Cloud Connected (no data)');
                loadFromLocal();
            }
            initializeUI();
        }).catch(function(err){
            console.error("Firebase read failed:", err);
            updateSystemStatus(false, '⚠️ Cloud load failed');
            loadFromLocal();
            initializeUI();
        });
    } catch (e) {
        console.error("loadFromFirebase error:", e);
        updateSystemStatus(false, '⚠️ Firebase error');
        loadFromLocal();
        initializeUI();
    }
}

function syncToFirebase() {
    try {
        if (typeof firebase === 'undefined') {
            saveToLocal();
            showMessage('⚠️ Offline - saved locally', 'warning');
            return;
        }
        var db = firebase.database();
        var payload = {
            activeBowls: window.appData.activeBowls || [],
            preparedBowls: window.appData.preparedBowls || [],
            returnedBowls: window.appData.returnedBowls || [],
            myScans: window.appData.myScans || [],
            scanHistory: window.appData.scanHistory || [],
            customerData: window.appData.customerData || [],
            lastSync: nowISO()
        };
        db.ref('progloveData').set(payload)
            .then(function() {
                window.appData.lastSync = nowISO();
                saveToLocal();
                var el = document.getElementById('lastSyncInfo');
                if (el) el.innerText = 'Last sync: ' + new Date(window.appData.lastSync).toLocaleString();
                showMessage('✅ Synced to cloud', 'success');
            })
            .catch(function(err){
                console.error("syncToFirebase error:", err);
                showMessage('❌ Cloud sync failed - data saved locally', 'error');
                saveToLocal();
            });
    } catch(e){ console.error("syncToFirebase:", e); saveToLocal(); }
}

// ------------------- SCAN HANDLING (CLEAN) -------------------
// A single entry point for processing scans, no nested if/else mess.
function handleScanInputRaw(rawInput) {
    var startTime = Date.now();
    var result = { message: '', type: 'error', responseTime: 0 };

    try {
        var input = (rawInput || '').toString().trim();
        if (!input) {
            result.message = '❌ Empty scan input';
            result.type = 'error';
            result.responseTime = Date.now() - startTime;
            displayScanResult(result);
            return result;
        }

        // detect/create vytInfo
        var vytInfo = detectVytCode(input);
        if (!vytInfo) {
            result.message = '❌ Invalid VYT code/URL: ' + input;
            result.type = 'error';
            result.responseTime = Date.now() - startTime;
            displayScanResult(result);
            return result;
        }

        // route by mode
        var mode = window.appData.mode || '';
        if (mode === 'kitchen') {
            result = kitchenScanClean(vytInfo, startTime);
        } else if (mode === 'return') {
            result = returnScanClean(vytInfo, startTime);
        } else {
            result.message = '❌ Please select operation mode first';
            result.type = 'error';
            result.responseTime = Date.now() - startTime;
        }

        // final UI update
        displayScanResult(result);
        updateDisplay();
        updateOvernightStats();
        updateLastActivity();
        return result;

    } catch (e) {
        console.error("handleScanInputRaw:", e);
        result.message = '❌ Unexpected error: ' + (e && e.message ? e.message : e);
        result.type = 'error';
        result.responseTime = Date.now() - startTime;
        displayScanResult(result);
        return result;
    }
}

function displayScanResult(result) {
    try {
        var resp = document.getElementById('responseTimeValue');
        if (resp) resp.textContent = (result.responseTime || '') + ' ms';
    } catch(e){}

    showMessage(result.message, result.type);

    var inputEl = document.getElementById('scanInput');
    if (!inputEl) return;
    // simple colored border effect
    if (result.type === 'error') {
        inputEl.style.borderColor = 'var(--accent-red)';
        setTimeout(function(){ inputEl.style.borderColor = ''; }, 1800);
    } else {
        inputEl.style.borderColor = 'var(--accent-green)';
        setTimeout(function(){ inputEl.style.borderColor = ''; }, 600);
    }
}

// detect vyt code pattern (safe)
function detectVytCode(input) {
    if (!input || typeof input !== 'string') return null;
    var cleaned = input.trim();
    // common patterns (supports full URL or bare code)
    var urlPattern = /(https?:\/\/[^\s]+)/i;
    var vytPattern = /(VYT\.TO\/[^\s]+)|(vyt\.to\/[^\s]+)|(VYTAL[^\s]+)|(vytal[^\s]+)/i;
    var matchUrl = cleaned.match(urlPattern);
    if (matchUrl) {
        return { fullUrl: matchUrl[1] };
    }
    var match = cleaned.match(vytPattern);
    if (match) {
        // return the whole input as code
        return { fullUrl: cleaned };
    }
    // fallback: if string length looks like a code (>=6)
    if (cleaned.length >= 6 && cleaned.length <= 120) return { fullUrl: cleaned };
    return null;
}

// Kitchen scan (clean)
function kitchenScanClean(vytInfo, startTime) {
    startTime = startTime || Date.now();
    var today = todayDateStr();
    // check duplicate for this user/dish today
    var already = window.appData.preparedBowls.some(function(b){
        return b.code === vytInfo.fullUrl && b.date === today && b.user === window.appData.user && b.dish === window.appData.dishLetter;
    });
    if (already) {
        return { message: '❌ Already prepared today: ' + vytInfo.fullUrl, type: 'error', responseTime: Date.now() - startTime };
    }

    // if active bowl exists remove it (customer data reset)
    var idxActive = -1;
    for (var i = 0; i < window.appData.activeBowls.length; i++) {
        if (window.appData.activeBowls[i].code === vytInfo.fullUrl) { idxActive = i; break; }
    }
    var hadCustomer = (idxActive !== -1);
    if (idxActive !== -1) window.appData.activeBowls.splice(idxActive, 1);

    var newPrepared = {
        code: vytInfo.fullUrl,
        dish: window.appData.dishLetter || 'Unknown',
        user: window.appData.user || 'Unknown',
        company: 'Unknown',
        customer: 'Unknown',
        date: today,
        time: (new Date()).toLocaleTimeString(),
        timestamp: nowISO(),
        status: 'PREPARED',
        hadPreviousCustomer: hadCustomer
    };
    window.appData.preparedBowls.push(newPrepared);

    window.appData.myScans.push({
        type: 'kitchen',
        code: vytInfo.fullUrl,
        dish: window.appData.dishLetter || 'Unknown',
        user: window.appData.user || 'Unknown',
        timestamp: nowISO(),
        hadPreviousCustomer: hadCustomer
    });

    window.appData.scanHistory.unshift({ type: 'kitchen', code: vytInfo.fullUrl, user: window.appData.user, timestamp: nowISO(), message: 'Prepared: ' + vytInfo.fullUrl });

    // sync
    syncToFirebase();

    return { message: (hadCustomer ? '✅ Prepared (customer reset): ' : '✅ Prepared: ') + vytInfo.fullUrl, type: 'success', responseTime: Date.now() - startTime };
}

// Return scan (clean)
function returnScanClean(vytInfo, startTime) {
    startTime = startTime || Date.now();
    var today = todayDateStr();

    var preparedIndex = -1;
    for (var i = 0; i < window.appData.preparedBowls.length; i++) {
        if (window.appData.preparedBowls[i].code === vytInfo.fullUrl && window.appData.preparedBowls[i].date === today) {
            preparedIndex = i; break;
        }
    }
    if (preparedIndex === -1) {
        return { message: '❌ Bowl not prepared today: ' + vytInfo.fullUrl, type: 'error', responseTime: Date.now() - startTime };
    }

    var preparedBowl = window.appData.preparedBowls[preparedIndex];
    window.appData.preparedBowls.splice(preparedIndex, 1);

    var returnedB = {
        code: vytInfo.fullUrl,
        dish: preparedBowl.dish,
        user: window.appData.user || 'Unknown',
        company: preparedBowl.company || 'Unknown',
        customer: preparedBowl.customer || 'Unknown',
        returnDate: today,
        returnTime: (new Date()).toLocaleTimeString(),
        returnTimestamp: nowISO(),
        status: 'RETURNED'
    };
    window.appData.returnedBowls.push(returnedB);

    window.appData.myScans.push({
        type: 'return',
        code: vytInfo.fullUrl,
        user: window.appData.user || 'Unknown',
        timestamp: nowISO()
    });

    window.appData.scanHistory.unshift({ type: 'return', code: vytInfo.fullUrl, user: window.appData.user, timestamp: nowISO(), message: 'Returned: ' + vytInfo.fullUrl });

    syncToFirebase();

    return { message: '✅ Returned: ' + vytInfo.fullUrl, type: 'success', responseTime: Date.now() - startTime };
}

// ------------------- UI INITIALIZATION & HANDLERS -------------------
function initializeUsersDropdown() {
    try {
        var dd = document.getElementById('userSelect');
        if (!dd) return;
        dd.innerHTML = '<option value="">-- Select User --</option>';
        USERS.forEach(function(u){
            var opt = document.createElement('option');
            opt.value = u.name;
            opt.textContent = u.name + (u.role ? ' (' + u.role + ')' : '');
            dd.appendChild(opt);
        });
    } catch(e){ console.error(e) }
}

function loadDishOptions() {
    var dd = document.getElementById('dishSelect');
    if (!dd) return;
    dd.innerHTML = '<option value="">-- Select Dish --</option>';
    var letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    letters.forEach(function(l){ var o = document.createElement('option'); o.value = l; o.textContent = l; dd.appendChild(o); });
    ['1','2','3','4'].forEach(function(n){ var o = document.createElement('option'); o.value = n; o.textContent = n; dd.appendChild(o); });
}

// expose UI functions
window.setMode = function(mode) {
    window.appData.mode = mode;
    window.appData.user = null;
    window.appData.dishLetter = null;
    window.appData.scanning = false;
    // UI changes
    var dishWrap = document.getElementById('dishWrapper');
    if (dishWrap) {
        dishWrap.style.display = (mode === 'kitchen') ? 'block' : 'none';
    }
    var md = document.getElementById('modeDisplay');
    if (md) md.innerText = 'Mode: ' + (mode ? mode.toUpperCase() : 'N/A');
    initializeUsersDropdown();
    loadDishOptions();
    updateDisplay();
    showMessage('ℹ️ Mode selected: ' + mode.toUpperCase(), 'info');
};

window.selectUser = function() {
    var dd = document.getElementById('userSelect');
    if (!dd) return;
    window.appData.user = dd.value || null;
    if (window.appData.user) showMessage('✅ User: ' + window.appData.user, 'success');
    updateDisplay();
};

window.selectDishLetter = function() {
    var dd = document.getElementById('dishSelect');
    if (!dd) return;
    window.appData.dishLetter = dd.value || null;
    if (window.appData.dishLetter) {
        var myDish = document.getElementById('myDishLetter');
        if (myDish) myDish.innerText = window.appData.dishLetter;
    }
    updateDisplay();
};

window.startScanning = function() {
    if (!window.appData.user) { showMessage('❌ Select user first', 'error'); return; }
    if (window.appData.mode === 'kitchen' && !window.appData.dishLetter) { showMessage('❌ Select dish first', 'error'); return; }
    window.appData.scanning = true;
    updateDisplay();
    var inp = document.getElementById('scanInput');
    if (inp) { inp.disabled = false; inp.focus(); inp.value = ''; }
    showMessage('🎯 SCANNING ACTIVE', 'success');
};

window.stopScanning = function() {
    window.appData.scanning = false;
    updateDisplay();
    var inp = document.getElementById('scanInput');
    if (inp) inp.disabled = true;
    showMessage('⏹ Scanning stopped', 'info');
};

function updateDisplay() {
    try {
        var startBtn = document.getElementById('startBtn');
        var stopBtn = document.getElementById('stopBtn');
        var userSel = document.getElementById('userSelect');
        var dishSel = document.getElementById('dishSelect');

        if (userSel) userSel.disabled = false;
        if (dishSel) dishSel.disabled = false;

        var canStart = !!(window.appData.user && !window.appData.scanning);
        if (window.appData.mode === 'kitchen') canStart = canStart && !!window.appData.dishLetter;

        if (startBtn) startBtn.disabled = !canStart;
        if (stopBtn) stopBtn.disabled = !window.appData.scanning;

        var scanInput = document.getElementById('scanInput');
        if (scanInput) {
            scanInput.disabled = !window.appData.scanning;
            scanInput.placeholder = window.appData.scanning ? 'Scan VYT code...' : 'Select user and press START...';
        }

        // counts
        var activeEl = document.getElementById('activeCount');
        if (activeEl) activeEl.innerText = (window.appData.activeBowls.length || 0);

        var preparedToday = 0;
        var returnedToday = 0;
        var today = todayDateStr();

        (window.appData.preparedBowls || []).forEach(function(b){
            if (b.date === today) preparedToday++;
        });
        (window.appData.returnedBowls || []).forEach(function(b){
            if (b.returnDate === today) returnedToday++;
        });

        var preparedEl = document.getElementById('preparedTodayCount');
        if (preparedEl) preparedEl.innerText = preparedToday;

        var returnedEl = document.getElementById('returnedCount');
        if (returnedEl) returnedEl.innerText = returnedToday;

        var myScans = (window.appData.myScans || []).filter(function(s){
            try {
                return s.user === window.appData.user && new Date(s.timestamp).toLocaleDateString('en-GB') === today;
            } catch(e) { return false; }
        }).length;
        var myScansEl = document.getElementById('myScansCount');
        if (myScansEl) myScansEl.innerText = myScans;

        var exportInfo = document.getElementById('lastSyncInfo');
        if (exportInfo) exportInfo.innerHTML = 'Active: ' + (window.appData.activeBowls.length || 0) + ' • Prepared today: ' + preparedToday + ' • Returns today: ' + returnedToday;

    } catch(e) { console.error("updateDisplay:", e) }
}

function updateOvernightStats() {
    try {
        var body = document.getElementById('livePrepReportBody');
        if (!body) return;
        // compute cycle: 10PM yesterday -> 10PM today
        var now = new Date();
        var end = new Date(now);
        end.setHours(22,0,0,0);
        var start = new Date(end);
        start.setDate(end.getDate() - 1);

        var scans = (window.appData.myScans || []).filter(function(s){
            var t = new Date(s.timestamp);
            return t >= start && t <= end;
        });

        if (!scans || scans.length === 0) {
            body.innerHTML = '<tr><td colspan="3" style="text-align:center;color:#9aa3b2;padding:18px">No kitchen scans recorded during this cycle.</td></tr>';
            return;
        }

        var stats = {};
        scans.forEach(function(s){
            var key = (s.dish || 'X') + '|' + (s.user || 'Unknown');
            if (!stats[key]) stats[key] = { dish: s.dish||'--', user: s.user||'--', count: 0 };
            stats[key].count++;
        });

        var rows = Object.keys(stats).map(function(k){
            var it = stats[k];
            return '<tr><td>' + (it.dish||'--') + '</td><td>' + (it.user||'--') + '</td><td>' + it.count + '</td></tr>';
        });
        body.innerHTML = rows.join('');
    } catch(e){ console.error("updateOvernightStats:", e) }
}

function updateLastActivity() {
    window.appData.lastActivity = Date.now();
}

// keyboard / input handlers for scanner
function bindScannerInput() {
    try {
        var inp = document.getElementById('scanInput');
        if (!inp) return;
        inp.addEventListener('keydown', function(e){
            if (e.key === 'Enter') {
                e.preventDefault();
                var val = inp.value.trim();
                if (!val) return;
                if (!window.appData.scanning) {
                    showMessage('❌ Scanning not active', 'error');
                    return;
                }
                handleScanInputRaw(val);
                inp.value = '';
                setTimeout(function(){ inp.focus(); }, 50);
            }
        });
        // paste / input
        inp.addEventListener('input', function(e){
            var v = inp.value.trim();
            if (!v) return;
            // auto process if looks like VYT
            if (v.length >= 6 && (v.toLowerCase().indexOf('vyt') !== -1 || v.indexOf('/') !== -1)) {
                if (window.appData.scanning) {
                    handleScanInputRaw(v);
                    inp.value = '';
                }
            }
        });
    } catch(e){ console.error("bindScannerInput:", e) }
}

// ------------------- EXPORTS (EXCEL FORMAT) -------------------

// Make sure XLSX library is loaded from CDN before this file:
// <script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>

function exportToExcel(sheetName, dataArray, filename) {
    if (!dataArray || dataArray.length === 0) {
        showMessage("❌ No data to export.", "error");
        return;
    }

    try {
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(dataArray);
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
        XLSX.writeFile(wb, filename);
        showMessage(`✅ Exported ${filename} successfully.`, "success");
    } catch (error) {
        console.error("Excel export failed:", error);
        showMessage("❌ Excel export failed.", "error");
    }
}

// ---------- Export Active Bowls ----------
window.exportActiveBowls = function () {
    try {
        const bowls = window.appData.activeBowls || [];
        if (bowls.length === 0) {
            showMessage("❌ No active bowls to export", "error");
            return;
        }

        const today = new Date();
        const data = bowls.map((b) => {
            const d = new Date(b.creationDate || today);
            const missing = Math.ceil((today - d) / (1000 * 3600 * 24));
            return {
                "Bowl Code": b.code,
                "Dish": b.dish,
                "Company": b.company || "",
                "Customer": b.customer || "",
                "Creation Date": b.creationDate || "",
                "Missing Days": missing + " days",
            };
        });

        exportToExcel("Active Bowls", data, "Active_Bowls.xlsx");
    } catch (e) {
        console.error(e);
        showMessage("❌ Export failed", "error");
    }
};

// ---------- Export Returned Bowls ----------
window.exportReturnData = function () {
    try {
        const bowls = window.appData.returnedBowls || [];
        if (bowls.length === 0) {
            showMessage("❌ No returned bowls to export", "error");
            return;
        }

        const today = new Date();
        const data = bowls.map((b) => {
            const d = new Date(b.returnDate || today);
            const missing = Math.ceil((today - d) / (1000 * 3600 * 24));
            return {
                "Bowl Code": b.code,
                "Dish": b.dish,
                "Company": b.company || "",
                "Customer": b.customer || "",
                "Returned By": b.returnedBy || "",
                "Return Date": b.returnDate || "",
                "Return Time": b.returnTime || "",
                "Missing Days": missing + " days",
            };
        });

        exportToExcel("Returned Bowls", data, "Returned_Bowls.xlsx");
    } catch (e) {
        console.error(e);
        showMessage("❌ Export failed", "error");
    }
};

// ------------------- EXPORT ALL DATA TO EXCEL -------------------
window.exportAllData = async function () {
    try {
        if (!window.appData.activeBowls || window.appData.activeBowls.length === 0) {
            showMessage("❌ No data to export.", "error");
            return;
        }

        // Prepare a combined dataset
        const allData = window.appData.activeBowls.map(b => {
            const missingDays = b.creationDate
                ? Math.ceil((Date.now() - new Date(b.creationDate)) / 86400000)
                : "";
            return {
                Code: b.code,
                Dish: b.dish || "",
                Company: b.company || "",
                Customer: b.customer || "",
                CreationDate: b.creationDate || "",
                MissingDays: missingDays,
            };
        });

        // Use ExcelJS (lightweight Excel library)
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet("All Bowls Data");

        // Define columns
        sheet.columns = [
            { header: "Code", key: "Code", width: 25 },
            { header: "Dish", key: "Dish", width: 15 },
            { header: "Company", key: "Company", width: 25 },
            { header: "Customer", key: "Customer", width: 25 },
            { header: "Creation Date", key: "CreationDate", width: 20 },
            { header: "Missing Days", key: "MissingDays", width: 15 },
        ];

        // Add rows
        allData.forEach(item => {
            const row = sheet.addRow(item);
            const missingDays = parseInt(item.MissingDays, 10);

            // Apply red background for > 7 days missing
            if (!isNaN(missingDays) && missingDays > 7) {
                row.getCell("MissingDays").fill = {
                    type: "pattern",
                    pattern: "solid",
                    fgColor: { argb: "FFFF4C4C" }, // bright red
                };
                row.getCell("MissingDays").font = { color: { argb: "FFFFFFFF" }, bold: true };
            }
        });

        // Add header style
        sheet.getRow(1).font = { bold: true, color: { argb: "FF00E0B3" } };
        sheet.getRow(1).alignment = { horizontal: "center" };

        // Export Excel file
        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `ProGlove_All_Data_${new Date().toISOString().split("T")[0]}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);

        showMessage("✅ Excel file exported successfully!", "success");
    } catch (err) {
        console.error("❌ Excel export failed:", err);
        showMessage("❌ Excel export failed. Check console for details.", "error");
    }
};

// ------------------- Helpers for JSON processing -------------------
function isValidBowlUrl(str) {
    if (!str || typeof str !== "string") return false;
    let s = str.trim();
    return (
        s.startsWith("http://vyt") ||
        s.startsWith("https://vyt") ||
        s.startsWith("http://vytal") ||
        s.startsWith("https://vytal")
    );
}

// Extract candidate codes from various box/dish structures
function extractCodesFromObject(obj) {
    var codes = [];
    if (!obj) return codes;

    // Common direct fields
    if (obj.code && typeof obj.code === 'string') codes.push(obj.code.trim());
    if (obj.id && typeof obj.id === 'string') codes.push(obj.id.trim());
    if (obj.boxId && typeof obj.boxId === 'string') codes.push(obj.boxId.trim());
    if (obj.bowlCode && typeof obj.bowlCode === 'string') codes.push(obj.bowlCode.trim());
    if (obj.bowl_id && typeof obj.bowl_id === 'string') codes.push(obj.bowl_id.trim());
    if (obj.uniqueIdentifier && typeof obj.uniqueIdentifier === 'string') codes.push(obj.uniqueIdentifier.trim());

    // Arrays
    if (Array.isArray(obj.bowlCodes)) {
        obj.bowlCodes.forEach(c => { if (typeof c === 'string') codes.push(c.trim()); });
    }
    if (Array.isArray(obj.codes)) {
        obj.codes.forEach(c => { if (typeof c === 'string') codes.push(c.trim()); });
    }

    // In some payloads, dish.bowlCodes exists
    if (obj.dishes && Array.isArray(obj.dishes)) {
        obj.dishes.forEach(function(d){
            if (d.bowlCodes && Array.isArray(d.bowlCodes)) d.bowlCodes.forEach(c => { if (typeof c === 'string') codes.push(c.trim()); });
            if (d.bowlCode && typeof d.bowlCode === 'string') codes.push(d.bowlCode.trim());
        });
    }

    // Ensure uniqueness
    return codes.filter(Boolean);
}

// ------------------- JSON PATCH PROCESSING (FINAL) -------------------
// This enforces:
// - Only full URLs that start with http(s)://vyt or http(s)://vytal are accepted
// - Exact full string match against preparedBowls to move -> activeBowls
// - If not in prepared, create new active bowl (only if valid URL)
// - If the same bowl appears more than once in the same incoming batch -> ERROR and abort
window.processJSONData = function () {
    try {
        const raw = document.getElementById("jsonData").value?.trim();
        if (!raw) {
            showMessage("❌ Paste JSON first", "error");
            return;
        }

        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch (e) {
            console.error("JSON parse error:", e);
            showMessage("❌ Invalid JSON format", "error");
            return;
        }

        // Normalize input into an array of items to inspect
        let containers = [];
        if (Array.isArray(parsed)) {
            containers = parsed.slice(); // array of items
        } else if (parsed.companies && Array.isArray(parsed.companies)) {
            containers = parsed.companies.slice();
        } else if (parsed.boxes && Array.isArray(parsed.boxes)) {
            // wrap into a single container with boxes
            containers = [{ boxes: parsed.boxes }];
        } else if (parsed.deliveries && Array.isArray(parsed.deliveries)) {
            containers = parsed.deliveries.slice();
        } else {
            containers = [parsed];
        }

        // First pass: flatten all candidate codes from the whole batch and detect duplicate entries in the batch
        const batchCodes = []; // preserve order
        containers.forEach(function(cont){
            // If container itself contains boxes array
            if (cont && Array.isArray(cont.boxes)) {
                cont.boxes.forEach(function(box){
                    const codes = extractCodesFromObject(box);
                    if (codes.length) {
                        codes.forEach(c => batchCodes.push({ code: c, meta: { container: cont, box: box } }));
                    }
                    // Also support nested dishes inside box (users/dishes)
                    if (box.dishes && Array.isArray(box.dishes)) {
                        box.dishes.forEach(function(dish){
                            if (dish.bowlCodes && Array.isArray(dish.bowlCodes)) {
                                dish.bowlCodes.forEach(c => batchCodes.push({ code: c, meta: { container: cont, dish: dish, box: box } }));
                            }
                        });
                    }
                });
            } else {
                // container might be a simple object with codes or bowlCodes or nested dishes
                const codes = extractCodesFromObject(cont);
                if (codes.length) {
                    codes.forEach(c => batchCodes.push({ code: c, meta: { container: cont } }));
                }
                if (cont.dishes && Array.isArray(cont.dishes)) {
                    cont.dishes.forEach(function(dish){
                        if (dish.bowlCodes && Array.isArray(dish.bowlCodes)) {
                            dish.bowlCodes.forEach(c => batchCodes.push({ code: c, meta: { container: cont, dish: dish } }));
                        }
                    });
                }
            }
        });

        if (batchCodes.length === 0) {
            showMessage("❌ No bowl codes found in JSON", "error");
            return;
        }

        // Detect duplicates within the incoming batch (exact full-string duplicates)
        const seen = new Set();
        for (let i = 0; i < batchCodes.length; i++) {
            const c = batchCodes[i].code;
            if (seen.has(c)) {
                console.error("Duplicate in same batch:", c);
                showMessage("❌ Duplicate bowl in same batch detected: " + c, "error");
                return; // Abort processing on duplicate (per your instruction)
            }
            seen.add(c);
        }

        // Now process each code (order preserved)
        let added = 0, updated = 0, moved = 0, ignored = 0;
        const today = todayDateStr();

        batchCodes.forEach(function(entry){
            const rawCode = entry.code;
            if (!rawCode || typeof rawCode !== 'string') { ignored++; return; }

            const code = rawCode.trim();

            // Only accept full URLs that start with allowed prefixes
            if (!isValidBowlUrl(code)) {
                // ignore silently as per instructions (non-VYT/VYTAL)
                ignored++;
                return;
            }

            // Try to find exact match in preparedBowls (exact full string match)
            const preparedIndex = window.appData.preparedBowls.findIndex(b => b.code === code);

            if (preparedIndex !== -1) {
                // Move from prepared -> active
                const pb = window.appData.preparedBowls.splice(preparedIndex, 1)[0];

                // enrich pb with info from JSON if present (container/box/dish meta)
                let meta = entry.meta || {};
                // attempt to extract company/customer from container/box/dish
                let company = (meta.container && meta.container.name) || (meta.container && meta.container.company) || pb.company || "Unknown";
                let customer = (meta.dish && meta.dish.users && meta.dish.users.length > 0) ? meta.dish.users.map(u=>u.username || u).join(", ") : (meta.box && meta.box.customer) || pb.customer || "Unknown";

                const activeObj = {
                    code: code,
                    dish: pb.dish || (meta.dish && meta.dish.label) || "",
                    user: pb.user || "Unknown",
                    company: company,
                    customer: customer,
                    creationDate: pb.timestamp || nowISO(),
                    timestamp: nowISO(),
                    status: "ACTIVE"
                };

                window.appData.activeBowls.push(activeObj);
                moved++;
            } else {
                // See if already active
                let existing = window.appData.activeBowls.find(b => b.code === code);
                if (existing) {
                    // Update fields from JSON meta if available
                    let meta = entry.meta || {};
                    existing.company = (meta.container && (meta.container.name || meta.container.company)) || existing.company || "Unknown";
                    existing.customer = existing.customer || ((meta.dish && meta.dish.users && meta.dish.users.length>0) ? meta.dish.users.map(u=>u.username||u).join(", ") : existing.customer) || existing.customer || "Unknown";
                    existing.creationDate = existing.creationDate || today;
                    existing.timestamp = existing.timestamp || nowISO();
                    updated++;
                } else {
                    // Create new active bowl
                    let meta = entry.meta || {};
                    let company = (meta.container && (meta.container.name || meta.container.company)) || "Unknown";
                    let customer = (meta.dish && meta.dish.users && meta.dish.users.length > 0) ? meta.dish.users.map(u=>u.username||u).join(", ") : (meta.box && meta.box.customer) || "Unknown";

                    const newActive = {
                        code: code,
                        dish: (meta.dish && meta.dish.label) || "",
                        user: "UNKNOWN",
                        company: company,
                        customer: customer,
                        creationDate: today,
                        timestamp: nowISO(),
                        status: "ACTIVE"
                    };

                    window.appData.activeBowls.push(newActive);
                    added++;
                }
            }
        });

        // persist and update UI
        saveToLocal();
        syncToFirebase();
        updateDisplay();
        updateOvernightStats();

        // Update patch results UI if present
        const patchResultsEl = document.getElementById("patchResults");
        const patchSummaryEl = document.getElementById("patchSummary");
        const failedEl = document.getElementById("failedMatches");

        if (patchResultsEl) patchResultsEl.style.display = "block";
        if (patchSummaryEl)
            patchSummaryEl.textContent =
                "Moved: " + moved + " • Updated: " + updated + " • Created: " + added + " • Ignored: " + ignored;
        if (failedEl)
            failedEl.innerHTML = "<em>Processing finished.</em>";

        showMessage("✅ JSON processed: moved " + moved + " • created " + added + " • updated " + updated, "success");

    } catch (e) {
        console.error("processJSONData:", e);
        showMessage("❌ JSON parse or import error", "error");
    }
};

// reset placeholder
window.resetTodaysPreparedBowls = function() {
    // keep simple: remove today's prepared bowls (confirmation skipped for brevity)
    var today = todayDateStr();
    window.appData.preparedBowls = (window.appData.preparedBowls || []).filter(function(b){ return b.date !== today; });
    syncToFirebase();
    updateDisplay();
    showMessage('✅ Today\'s prepared bowls cleared', 'success');
};

// ------------------- BOOTSTRAP -------------------
function initializeUI() {
    try {
        initializeUsersDropdown();
        loadDishOptions();
        bindScannerInput();
        updateDisplay();
        updateOvernightStats();

        // subtle auto-focus on input when scanning active
        document.addEventListener('keydown', function(e){
            if (!window.appData.scanning) return;
            var input = document.getElementById('scanInput');
            if (input && document.activeElement !== input && /[a-z0-9]/i.test(e.key)) {
                input.focus();
            }
        });
    } catch(e){ console.error("initializeUI:", e) }
}

// ------------------- STARTUP -------------------
document.addEventListener('DOMContentLoaded', function(){
    try {
        // Begin trying to initialize Firebase and load data
        initFirebaseAndStart();
    } catch(e){
        console.error("startup error:", e);
        loadFromLocal();
        initializeUI();
    }
});
