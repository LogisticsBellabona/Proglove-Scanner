/* app-logic.js
   Firebase-only single-file app logic for ProGlove Bowl Tracker
   - Keeps original features (scan handling, JSON import, exports, stats)
   - Removes localStorage entirely (cloud-only)
   - Auto-syncs every change to Firebase (progloveData)
   - Real-time two-way sync: remote updates update local appData/UI instantly
*/

/* =========================
   GLOBAL STATE + CONSTS
   ========================= */
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

/* =========================
   FIREBASE CONFIG
   (uses the new project keys you provided)
   ========================= */
// firebaseConfig is defined in index.html before this script loads

/* =========================
   UTILITIES
   ========================= */
function nowISO() { return (new Date()).toISOString(); }
function todayDateStr() { return (new Date()).toLocaleDateString('en-GB'); }

function showMessage(message, type) {
    try {
        var container = document.getElementById('messageContainer');
        if (!container) {
            // fallback: console
            if (type === 'error') console.error(message); else console.log(message);
            return;
        }
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

/* =========================
   FIREBASE: INIT / MONITOR / REAL-TIME SYNC
   ========================= */
function initFirebaseAndStart() {
    try {
        if (typeof firebase === "undefined") {
            console.error("❌ Firebase SDK not loaded — check script includes.");
            updateSystemStatus(false, "Firebase SDK missing");
            initializeUI();
            return;
        }

        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
            console.log("✅ Firebase initialized:", firebaseConfig.projectId);
        } else {
            try {
                console.log("ℹ️ Firebase already initialized:", firebase.apps[0].options.projectId);
            } catch(e) { console.log("ℹ️ Firebase already initialized (unknown name)"); }
        }

        // Attempt anonymous auth so writes are allowed when anonymous auth is enabled
        try {
            if (firebase.auth && typeof firebase.auth === 'function') {
                firebase.auth().onAuthStateChanged(function(user){
                    if (!user) {
                        firebase.auth().signInAnonymously().catch(function(err){
                            console.warn("Anonymous sign-in failed:", err && err.message ? err.message : err);
                        });
                    }
                });
            }
        } catch(e){ console.warn("Auth init warning:", e); }

        monitorConnection();
        attachRealtimeListener();
        loadFromFirebaseOnce();

    } catch (e) {
        console.error("❌ initFirebaseAndStart error:", e);
        updateSystemStatus(false, "Firebase init failed");
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

// load once initially
function loadFromFirebaseOnce() {
    try {
        var db = firebase.database();
        var ref = db.ref('progloveData');
        ref.once('value').then(function(snapshot) {
            if (snapshot && snapshot.exists && snapshot.exists()) {
                var val = snapshot.val() || {};
                // replace lists with cloud values
                window.appData.activeBowls = val.activeBowls || window.appData.activeBowls || [];
                window.appData.preparedBowls = val.preparedBowls || window.appData.preparedBowls || [];
                window.appData.returnedBowls = val.returnedBowls || window.appData.returnedBowls || [];
                window.appData.myScans = val.myScans || window.appData.myScans || [];
                window.appData.scanHistory = val.scanHistory || window.appData.scanHistory || [];
                window.appData.customerData = val.customerData || window.appData.customerData || [];
                window.appData.lastSync = val.lastSync || nowISO();
                updateSystemStatus(true);
                showMessage('✅ Cloud data loaded', 'success');
            } else {
                updateSystemStatus(true, '✅ Cloud Connected (no data)');
            }
            initializeUI();
            updateDisplay();
        }).catch(function(err){
            console.error("Firebase read failed:", err);
            updateSystemStatus(false, '⚠️ Cloud load failed');
            initializeUI();
        });
    } catch (e) {
        console.error("loadFromFirebase error:", e);
        updateSystemStatus(false, '⚠️ Firebase error');
        initializeUI();
    }
}

// attach real-time two-way listener
function attachRealtimeListener() {
    try {
        var db = firebase.database();
        var ref = db.ref('progloveData');
        ref.on('value', function(snapshot){
            try {
                if (!snapshot || !snapshot.exists()) {
                    // no cloud data yet
                    return;
                }
                var val = snapshot.val() || {};
                // replace the important arrays with cloud state to keep in sync
                window.appData.activeBowls = val.activeBowls || [];
                window.appData.preparedBowls = val.preparedBowls || [];
                window.appData.returnedBowls = val.returnedBowls || [];
                window.appData.myScans = val.myScans || [];
                window.appData.scanHistory = val.scanHistory || [];
                window.appData.customerData = val.customerData || [];
                window.appData.lastSync = val.lastSync || nowISO();
                updateDisplay();
                updateOvernightStats();
                console.log("🔁 Real-time update applied from cloud.");
            } catch(e) {
                console.warn("Realtime listener handler error:", e);
            }
        });
    } catch(e) {
        console.warn("Could not attach realtime listener:", e);
    }
}

function syncToFirebase() {
    try {
        if (typeof firebase === 'undefined') return;
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
        db.ref('progloveData').update(payload).then(function(){
            window.appData.lastSync = payload.lastSync;
            console.log("✅ Synced to Firebase:", payload.lastSync);
        }).catch(function(err){
            console.error("❌ Firebase sync failed:", err);
            showMessage("⚠️ Sync failed", "error");
        });
    } catch (e) {
        console.error("syncToFirebase error:", e);
    }
}

/* =========================
   SCAN HANDLING (unchanged behavior, auto-sync on state change)
   ========================= */
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

    // auto-sync
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

/* =========================
   UI: users, dish options, start/stop scanning
   ========================= */
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

window.setMode = function(mode) {
    window.appData.mode = mode;
    window.appData.user = null;
    window.appData.dishLetter = null;
    window.appData.scanning = false;
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

/* =========================
   Keyboard / input handlers for scanner
   ========================= */
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

/* =========================
   EXPORTS (XLSX / Excel)
   ========================= */
// exportToExcel - supports XLSX (sheetjs) or ExcelJS if loaded
function exportToExcel(sheetName, dataArray, filename) {
    if (!dataArray || dataArray.length === 0) {
        showMessage("❌ No data to export.", "error");
        return;
    }

    try {
        if (window.XLSX) {
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.json_to_sheet(dataArray);
            XLSX.utils.book_append_sheet(wb, ws, sheetName);
            XLSX.writeFile(wb, filename);
            showMessage(`✅ Exported ${filename} successfully.`, "success");
            return;
        }
        if (window.ExcelJS) {
            (async function(){
                const workbook = new ExcelJS.Workbook();
                const sheet = workbook.addWorksheet(sheetName);
                if (dataArray.length > 0) {
                    const keys = Object.keys(dataArray[0]);
                    sheet.columns = keys.map(k => ({ header: k, key: k, width: 20 }));
                    dataArray.forEach(r => sheet.addRow(r));
                }
                const buffer = await workbook.xlsx.writeBuffer();
                const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = filename; a.click();
                URL.revokeObjectURL(url);
                showMessage("✅ Exported Excel", "success");
            })().catch(err => { console.error(err); showMessage("❌ Export failed", "error"); });
            return;
        }
        showMessage("❌ No spreadsheet library loaded (XLSX or ExcelJS)", "error");
    } catch (error) {
        console.error("Excel export failed:", error);
        showMessage("❌ Excel export failed.", "error");
    }
}

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

window.exportAllData = async function () {
    try {
        if (!window.appData.activeBowls || window.appData.activeBowls.length === 0) {
            showMessage("❌ No data to export.", "error");
            return;
        }

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

        if (window.ExcelJS) {
            const workbook = new ExcelJS.Workbook();
            const sheet = workbook.addWorksheet("All Bowls Data");
            sheet.columns = [
                { header: "Code", key: "Code", width: 25 },
                { header: "Dish", key: "Dish", width: 15 },
                { header: "Company", key: "Company", width: 25 },
                { header: "Customer", key: "Customer", width: 25 },
                { header: "Creation Date", key: "CreationDate", width: 20 },
                { header: "Missing Days", key: "MissingDays", width: 15 },
            ];
            allData.forEach(item => {
                const row = sheet.addRow(item);
                const missingDays = parseInt(item.MissingDays, 10);
                if (!isNaN(missingDays) && missingDays > 7) {
                    row.getCell("MissingDays").fill = {
                        type: "pattern",
                        pattern: "solid",
                        fgColor: { argb: "FFFF4C4C" },
                    };
                    row.getCell("MissingDays").font = { color: { argb: "FFFFFFFF" }, bold: true };
                }
            });
            sheet.getRow(1).font = { bold: true, color: { argb: "FF00E0B3" } };
            sheet.getRow(1).alignment = { horizontal: "center" };
            const buffer = await workbook.xlsx.writeBuffer();
            const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `ProGlove_All_Data_${new Date().toISOString().split("T")[0]}.xlsx`;
            a.click();
            URL.revokeObjectURL(url);
            showMessage("✅ Excel file exported successfully!", "success");
            return;
        } else {
            exportToExcel("All Data", allData, `ProGlove_All_Data_${new Date().toISOString().split("T")[0]}.xlsx`);
        }
    } catch (err) {
        console.error("❌ Excel export failed:", err);
        showMessage("❌ Excel export failed. Check console for details.", "error");
    }
};

/* =========================
   JSON PATCH PROCESSING
   ========================= */
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

function extractCodesFromObject(obj) {
    var codes = [];
    if (!obj) return codes;

    if (obj.code && typeof obj.code === 'string') codes.push(obj.code.trim());
    if (obj.id && typeof obj.id === 'string') codes.push(obj.id.trim());
    if (obj.boxId && typeof obj.boxId === 'string') codes.push(obj.boxId.trim());
    if (obj.bowlCode && typeof obj.bowlCode === 'string') codes.push(obj.bowlCode.trim());
    if (obj.bowl_id && typeof obj.bowl_id === 'string') codes.push(obj.bowl_id.trim());
    if (obj.uniqueIdentifier && typeof obj.uniqueIdentifier === 'string') codes.push(obj.uniqueIdentifier.trim());

    if (Array.isArray(obj.bowlCodes)) {
        obj.bowlCodes.forEach(c => { if (typeof c === 'string') codes.push(c.trim()); });
    }
    if (Array.isArray(obj.codes)) {
        obj.codes.forEach(c => { if (typeof c === 'string') codes.push(c.trim()); });
    }

    if (obj.dishes && Array.isArray(obj.dishes)) {
        obj.dishes.forEach(function(d){
            if (d.bowlCodes && Array.isArray(d.bowlCodes)) d.bowlCodes.forEach(c => { if (typeof c === 'string') codes.push(c.trim()); });
            if (d.bowlCode && typeof d.bowlCode === 'string') codes.push(d.bowlCode.trim());
        });
    }

    return codes.filter(Boolean);
}

window.processJSONData = async function () {
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

    // Flatten structure: find every bowl code in any nested path
    const batchCodes = [];
    function extractAllCodes(obj, meta = {}) {
      if (!obj) return;

      // Direct fields
      const possibleFields = ["code", "bowlCode", "bowl_id", "id", "uniqueIdentifier"];
      for (const field of possibleFields) {
        if (obj[field] && typeof obj[field] === "string") {
          batchCodes.push({ code: obj[field].trim(), meta });
        }
      }

      // Arrays of codes
      if (Array.isArray(obj.codes)) {
        obj.codes.forEach(c => batchCodes.push({ code: c.trim(), meta }));
      }
      if (Array.isArray(obj.bowlCodes)) {
        obj.bowlCodes.forEach(c => batchCodes.push({ code: c.trim(), meta }));
      }

      // Nested structures
      if (Array.isArray(obj.boxes)) obj.boxes.forEach(b => extractAllCodes(b, { ...meta, box: b }));
      if (Array.isArray(obj.dishes)) obj.dishes.forEach(d => extractAllCodes(d, { ...meta, dish: d }));
      if (Array.isArray(obj.companies)) obj.companies.forEach(c => extractAllCodes(c, { ...meta, company: c }));
      if (Array.isArray(obj.deliveries)) obj.deliveries.forEach(d => extractAllCodes(d, { ...meta, delivery: d }));
    }

    extractAllCodes(parsed);

    if (batchCodes.length === 0) {
      showMessage("❌ No bowl codes found in JSON", "error");
      return;
    }

    // Remove duplicates (keep first occurrence)
    const seen = new Set();
    const uniqueBatch = batchCodes.filter(entry => {
      if (seen.has(entry.code)) {
        console.warn("⚠️ Duplicate skipped:", entry.code);
        return false;
      }
      seen.add(entry.code);
      return true;
    });

    // Process each bowl
    let added = 0, updated = 0, moved = 0;
    const today = todayDateStr();

    for (const entry of uniqueBatch) {
      const code = entry.code;
      const meta = entry.meta || {};

      if (!isValidBowlUrl(code)) continue; // skip invalid

      // Find if this bowl already exists
      const prepIndex = window.appData.preparedBowls.findIndex(b => b.code === code);
      const activeIndex = window.appData.activeBowls.findIndex(b => b.code === code);

      // Extract metadata
      const company =
        (meta.company && (meta.company.name || meta.company.company)) ||
        (meta.box && (meta.box.company || meta.box.name)) ||
        (meta.delivery && meta.delivery.company) ||
        "Unknown";

      const customer =
        (meta.dish && Array.isArray(meta.dish.users) && meta.dish.users.length > 0)
          ? meta.dish.users.map(u => u.username || u).join(", ")
          : (meta.box && meta.box.customer) ||
            (meta.company && meta.company.customer) ||
            "Unknown";

      const dish =
        (meta.dish && meta.dish.label) ||
        (meta.box && meta.box.dish) ||
        "";

      if (prepIndex !== -1) {
        // Move prepared → active
        const bowl = window.appData.preparedBowls.splice(prepIndex, 1)[0];
        const activeObj = {
          code,
          dish: bowl.dish || dish,
          user: bowl.user || "Unknown",
          company,
          customer,
          creationDate: bowl.timestamp || nowISO(),
          timestamp: nowISO(),
          status: "ACTIVE"
        };
        window.appData.activeBowls.push(activeObj);
        moved++;
      } else if (activeIndex !== -1) {
        // Update existing active
        const bowl = window.appData.activeBowls[activeIndex];
        bowl.company = company;
        bowl.customer = customer;
        bowl.dish = bowl.dish || dish;
        bowl.timestamp = nowISO();
        updated++;
      } else {
        // Create new active
        const newBowl = {
          code,
          dish,
          user: "UNKNOWN",
          company,
          customer,
          creationDate: today,
          timestamp: nowISO(),
          status: "ACTIVE"
        };
        window.appData.activeBowls.push(newBowl);
        added++;
      }
    }

    // Auto sync with Firebase (real-time)
    syncToFirebase();

    // UI feedback
    updateDisplay();
    updateOvernightStats();

    const summary = `✅ JSON processed — Moved: ${moved} • Updated: ${updated} • Added: ${added}`;
    showMessage(summary, "success");
    console.log(summary);

  } catch (e) {
    console.error("processJSONData error:", e);
    showMessage("❌ JSON processing failed", "error");
  }
};


        // auto-sync and update UI
        syncToFirebase();
        updateDisplay();
        updateOvernightStats();

        const patchSummaryEl = document.getElementById("patchSummary");
        if (patchSummaryEl) patchSummaryEl.textContent = "Moved: " + moved + " • Updated: " + updated + " • Created: " + added + " • Ignored: " + ignored;

        showMessage("✅ JSON processed: moved " + moved + " • created " + added + " • updated " + updated, "success");

    } catch (e) {
        console.error("processJSONData:", e);
        showMessage("❌ JSON parse or import error", "error");
    }
};

/* =========================
   Reset / helpers
   ========================= */
window.resetTodaysPreparedBowls = function() {
    var today = todayDateStr();
    window.appData.preparedBowls = (window.appData.preparedBowls || []).filter(function(b){ return b.date !== today; });
    syncToFirebase();
    updateDisplay();
    showMessage('✅ Today\'s prepared bowls cleared', 'success');
};

/* =========================
   Bootstrap / UI init
   ========================= */
function initializeUI() {
    try {
        initializeUsersDropdown();
        loadDishOptions();
        bindScannerInput();
        updateDisplay();
        updateOvernightStats();

        document.addEventListener('keydown', function(e){
            if (!window.appData.scanning) return;
            var input = document.getElementById('scanInput');
            if (input && document.activeElement !== input && /[a-z0-9]/i.test(e.key)) {
                input.focus();
            }
        });
    } catch(e){ console.error("initializeUI:", e) }
}
