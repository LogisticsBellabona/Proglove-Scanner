/* app-logic.js
   Full client logic for ProGlove Bowl Tracking System
   - Real-time sync with Firebase Realtime DB
   - Robust JSON import (duplicate-safe)
   - No UI design changes — only plumbing and bug fixes
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

// Small user list (as in your Berlin file)
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

// Prevent redeclaring firebaseConfig here (index.html already initialized firebase).
// If needed, firebase.app().options can be inspected in code.

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
        }, 3500);
    } catch(e){ console.error("showMessage error:",e) }
}

function nowISO() { return (new Date()).toISOString(); }
function todayDateStr() { return (new Date()).toLocaleDateString('en-GB'); }

// ------------------- STORAGE (local fallback if needed) -------------------
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

// ------------------- FIREBASE / REALTIME -------------------
// ensure firebase initialized (index.html initializes it). If not, bail gracefully.
function initFirebaseRealtime() {
    try {
        if (typeof firebase === 'undefined') {
            console.error("Firebase SDK not loaded — check index.html includes.");
            updateSystemStatus(false, "Firebase SDK missing");
            loadFromLocal();
            initializeUI();
            return;
        }

        // Choose DB path: this uses main path 'progloveData' (production). Change if needed.
        window._db = firebase.database();
        window._dbRef = window._db.ref('progloveData');

        // Monitor connection
        var connectedRef = window._db.ref('.info/connected');
        connectedRef.on('value', function (snap) {
            try {
                if (snap && snap.val() === true) {
                    updateSystemStatus(true, "✅ Firebase Connected");
                } else {
                    updateSystemStatus(false, "⚠️ Firebase Disconnected");
                }
            } catch(e){ console.warn("monitorConnection callback error:", e); }
        });

        // Real-time data listener: keep local appData in sync when remote changes.
        window._dbRef.on('value', function(snap){
            try {
                var val = snap && snap.val();
                if (!val) {
                    // no cloud data yet
                    updateSystemStatus(true, '✅ Cloud Connected (no data)');
                    // keep local
                    initializeUI();
                    return;
                }
                // merge cloud into appData (cloud is master)
                window.appData.activeBowls = val.activeBowls || [];
                window.appData.preparedBowls = val.preparedBowls || [];
                window.appData.returnedBowls = val.returnedBowls || [];
                window.appData.myScans = val.myScans || [];
                window.appData.scanHistory = val.scanHistory || [];
                window.appData.customerData = val.customerData || [];
                window.appData.lastSync = val.lastSync || nowISO();
                saveToLocal();
                updateSystemStatus(true, '✅ Cloud data loaded');
                updateDisplay();
                initializeUI();
            } catch (e) {
                console.error("Realtime value handler error:", e);
            }
        }, function(err){
            console.error("Realtime listener failed:", err);
            updateSystemStatus(false, '⚠️ Cloud listener failed');
            loadFromLocal();
            initializeUI();
        });

        console.log("⏳ Firebase realtime initialized.");
    } catch (e) {
        console.error("initFirebaseRealtime error:", e);
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

// Push full appData to Firebase (atomic set)
function pushFullToFirebase() {
    try {
        if (!window._dbRef) {
            console.warn("pushFullToFirebase skipped: DB not ready");
            return;
        }
        var payload = {
            activeBowls: window.appData.activeBowls || [],
            preparedBowls: window.appData.preparedBowls || [],
            returnedBowls: window.appData.returnedBowls || [],
            myScans: window.appData.myScans || [],
            scanHistory: window.appData.scanHistory || [],
            customerData: window.appData.customerData || [],
            lastSync: nowISO()
        };
        window._dbRef.set(payload)
            .then(function(){ console.log('✅ Auto-synced full data to Firebase'); })
            .catch(function(err){ console.error('❌ Full sync error:', err); });
    } catch (e) { console.error('pushFullToFirebase error:',e); }
}

// Partial update (safe)
function updatePartialToFirebase(partial) {
    try {
        if (!window._dbRef) { console.warn("updatePartialToFirebase: DB not ready"); return; }
        window._dbRef.update(partial)
            .then(function(){ console.log('✅ Partial update to Firebase'); })
            .catch(function(err){ console.error('❌ Partial update error:', err); });
    } catch(e) { console.error('updatePartialToFirebase error:', e); }
}

// ------------------- SCAN HANDLING -------------------
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

        var vytInfo = detectVytCode(input);
        if (!vytInfo) {
            result.message = '❌ Invalid VYT code/URL: ' + input;
            result.type = 'error';
            result.responseTime = Date.now() - startTime;
            displayScanResult(result);
            return result;
        }

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
    if (result.type === 'error') {
        inputEl.style.borderColor = 'var(--accent-red)';
        setTimeout(function(){ inputEl.style.borderColor = ''; }, 1800);
    } else {
        inputEl.style.borderColor = 'var(--accent-green)';
        setTimeout(function(){ inputEl.style.borderColor = ''; }, 600);
    }
}

function detectVytCode(input) {
    if (!input || typeof input !== 'string') return null;
    var cleaned = input.trim();
    var urlPattern = /(https?:\/\/[^\s]+)/i;
    var vytPattern = /(VYT\.TO\/[^\s]+)|(vyt\.to\/[^\s]+)|(VYTAL[^\s]+)|(vytal[^\s]+)/i;
    var matchUrl = cleaned.match(urlPattern);
    if (matchUrl) {
        return { fullUrl: matchUrl[1] };
    }
    var match = cleaned.match(vytPattern);
    if (match) {
        return { fullUrl: cleaned };
    }
    if (cleaned.length >= 6 && cleaned.length <= 120) return { fullUrl: cleaned };
    return null;
}

// Kitchen scan (clean)
function kitchenScanClean(vytInfo, startTime) {
    startTime = startTime || Date.now();
    var today = todayDateStr();
    var already = window.appData.preparedBowls.some(function(b){
        return b.code === vytInfo.fullUrl && b.date === today && b.user === window.appData.user && b.dish === window.appData.dishLetter;
    });
    if (already) {
        return { message: '❌ Already prepared today: ' + vytInfo.fullUrl, type: 'error', responseTime: Date.now() - startTime };
    }

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
    pushFullToFirebase();

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

    pushFullToFirebase();

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
        inp.addEventListener('input', function(e){
            var v = inp.value.trim();
            if (!v) return;
            if (v.length >= 6 && (v.toLowerCase().indexOf('vyt') !== -1 || v.indexOf('/') !== -1)) {
                if (window.appData.scanning) {
                    handleScanInputRaw(v);
                    inp.value = '';
                }
            }
        });
    } catch(e){ console.error("bindScannerInput:", e) }
}

// ------------------- EXPORT ALL DATA (fixed mapping to match Berlin) -------------------
window.exportAllData = function () {
    try {
        const bowls = window.appData.activeBowls || [];
        if (!bowls || bowls.length === 0) {
            showMessage("❌ No data to export.", "error");
            return;
        }

        // helper: pick the best available 'code' field (prefer VYT code)
        function pickCode(b) {
            // often we use: code, Code, bowlCode, id, uid, uniqueIdentifier
            let c = (b.code || b.Code || b.bowlCode || b.bowl_id || b.id || b.uid || b.uniqueIdentifier || "").toString();
            if (!c) return "";
            return c;
        }

        // helper: pick dish field
        function pickDish(b) {
            return (b.dish || b.Dish || b.dishLetter || b.dish_label || b.type || "") || "";
        }

        // helper: pick company
        function pickCompany(b) {
            return (b.company || b.Company || b.org || b.organization || b.companyName || "") || "";
        }

        // helper: pick customer
        function pickCustomer(b) {
            // customer can be array or string
            if (Array.isArray(b.customer)) return b.customer.join(", ");
            return (b.customer || b.Customer || b.customerName || b.customer_name || b.client || "") || "";
        }

        // helper: pick creation date from multiple possible keys, return YYYY-MM-DD or blank
        function pickCreationDate(b) {
            const candidates = [b.creationDate, b.creation_date, b.creation, b.CreationDate, b["Creation Date"], b.timestamp, b.createdAt, b.date, b.creationTimestamp];
            for (let v of candidates) {
                if (!v && v !== 0) continue;
                try {
                    // if already string in ISO or YYYY-MM-DD, try to parse
                    let d = new Date(v);
                    if (!isNaN(d.getTime())) {
                        // format YYYY-MM-DD
                        return d.toISOString().split("T")[0];
                    }
                } catch (e) { /* ignore */ }
                // fallback: if it's already a string that looks like YYYY-MM-DD
                if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.split("T")[0];
            }
            return "";
        }

        // helper: compute missing days between creationDate and today
        function computeMissingDays(creationDateStr) {
            try {
                if (!creationDateStr) return "";
                const cd = new Date(creationDateStr);
                if (isNaN(cd.getTime())) return "";
                const today = new Date();
                const diff = Math.ceil((today - cd) / (1000 * 60 * 60 * 24));
                return diff;
            } catch (e) { return ""; }
        }

        // Build rows with Berlin-style headers precisely:
        // Code, Dish, Company, Customer, Creation Date, Missing Days
        const rows = bowls.map(b => {
            const code = pickCode(b);
            const dish = pickDish(b);
            const company = pickCompany(b);
            const customer = pickCustomer(b);
            const creationDate = pickCreationDate(b);
            const missingDays = computeMissingDays(creationDate);
            return {
                "Code": code,
                "Dish": dish,
                "Company": company,
                "Customer": customer,
                "Creation Date": creationDate,
                "Missing Days": missingDays
            };
        });

        // Use XLSX to export (keeps same header names)
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(rows, {header: ["Code","Dish","Company","Customer","Creation Date","Missing Days"]});
        XLSX.utils.book_append_sheet(wb, ws, "All Data");
        const filename = `ProGlove_All_Data_${new Date().toISOString().split("T")[0]}.xlsx`;
        XLSX.writeFile(wb, filename);
        showMessage("✅ Excel file exported successfully!", "success");
    } catch (err) {
        console.error("❌ Export ALL failed:", err);
        showMessage("❌ Excel export failed. See console.", "error");
    }
const nonVytCount = rows.filter(r => !/https?:\/\/vyt\.to\//i.test(r["Code"])).length;
if (nonVytCount > 0) {
  console.warn(nonVytCount + " rows do not contain vyt links in 'Code' column. Exporting anyway.");
  showMessage("⚠️ " + nonVytCount + " rows have non-VYT codes. Check console.", "warning");
}
};

// ------------------- JSON IMPORT / PATCH (FIXED) -------------------
window.processJSONData = async function () {
    try {
        const input = document.getElementById("jsonData").value.trim();
        if (!input) {
            showMessage("⚠️ Please paste JSON data first.", "warning");
            return;
        }

        const parsed = JSON.parse(input);
        if (!Array.isArray(parsed)) {
            showMessage("❌ JSON should be an array of bowls.", "error");
            return;
        }

        const seen = new Set();
        let imported = 0, skipped = 0, updated = 0;

        for (const bowl of parsed) {
            const code = (bowl.code || bowl.Code || bowl.bowlCode || bowl.id || "").trim().toLowerCase();
            if (!code) continue;

            // skip duplicate entries in same batch
            if (seen.has(code)) {
                console.warn("⚠️ Duplicate skipped (same bowl found twice):", code);
                skipped++;
                continue;
            }
            seen.add(code);

            // try to find existing bowl
            const idx = (window.appData.activeBowls || []).findIndex(
                b => (b.code || "").toLowerCase() === code
            );

            // normalize incoming data — preserve original fields
            const newBowl = {
                code: bowl.code || bowl.Code || bowl.bowlCode || bowl.id || "",
                dish: bowl.dish || bowl.Dish || bowl.dishLetter || "",
                company: bowl.company || bowl.Company || bowl.companyName || bowl.org || "",
                customer: bowl.customer || bowl.Customer || bowl.customerName || "",
                creationDate: bowl.creationDate || bowl.CreationDate || bowl["Creation Date"] || bowl.date || "",
                lastUpdate: nowISO()
            };

            // if no creationDate in JSON, preserve existing or fallback to now
            if (!newBowl.creationDate) {
                if (idx >= 0 && window.appData.activeBowls[idx].creationDate)
                    newBowl.creationDate = window.appData.activeBowls[idx].creationDate;
                else
                    newBowl.creationDate = nowISO();
            }

            if (idx >= 0) {
                // update existing bowl
                window.appData.activeBowls[idx] = {
                    ...window.appData.activeBowls[idx],
                    ...newBowl
                };
                updated++;
            } else {
                // add new bowl
                window.appData.activeBowls.push(newBowl);
                imported++;
            }
        }

        console.log(`✅ ${imported} new, ${updated} updated, ${skipped} skipped`);
        showMessage(`✅ Imported ${imported} bowls (${updated} updated, ${skipped} skipped).`, "success");

        // Sync instantly to Firebase
        syncToFirebase();

    } catch (e) {
        console.error("processJSONData error:", e);
        showMessage("❌ JSON processing failed. Check console.", "error");
    }
};


// reset today's prepared bowls
window.resetTodaysPreparedBowls = function() {
    var today = todayDateStr();
    window.appData.preparedBowls = (window.appData.preparedBowls || []).filter(function(b){ return b.date !== today; });
    pushFullToFirebase();
    updateDisplay();
    showMessage('✅ Today\'s prepared bowls cleared', 'success');
};

// ------------------- JSON IMPORT/EXTRACT HELPERS (EXPOSED) -------------------
function extractCodesFromObject(obj) {
    var codes = [];
    if (!obj) return codes;
    if (obj.code && typeof obj.code === 'string') codes.push(obj.code.trim());
    if (obj.id && typeof obj.id === 'string') codes.push(obj.id.trim());
    if (obj.boxId && typeof obj.boxId === 'string') codes.push(obj.boxId.trim());
    if (obj.bowlCode && typeof obj.bowlCode === 'string') codes.push(obj.bowlCode.trim());
    if (obj.bowl_id && typeof obj.bowl_id === 'string') codes.push(obj.bowl_id.trim());
    if (obj.uniqueIdentifier && typeof obj.uniqueIdentifier === 'string') codes.push(obj.uniqueIdentifier.trim());
    if (Array.isArray(obj.bowlCodes)) obj.bowlCodes.forEach(c => { if (typeof c === 'string') codes.push(c.trim()); });
    if (Array.isArray(obj.codes)) obj.codes.forEach(c => { if (typeof c === 'string') codes.push(c.trim()); });
    if (obj.dishes && Array.isArray(obj.dishes)) {
        obj.dishes.forEach(function(d){
            if (d.bowlCodes && Array.isArray(d.bowlCodes)) d.bowlCodes.forEach(c => { if (typeof c === 'string') codes.push(c.trim()); });
            if (d.bowlCode && typeof d.bowlCode === 'string') codes.push(d.bowlCode.trim());
        });
    }
    return codes.filter(Boolean);
}

// ------------------- PROCESS JSON PATCH (already defined above as processJSONData) -------------------

// ------------------- BOOTSTRAP & INPUT BINDING -------------------
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
        inp.addEventListener('input', function(e){
            var v = inp.value.trim();
            if (!v) return;
            if (v.length >= 6 && (v.toLowerCase().indexOf('vyt') !== -1 || v.indexOf('/') !== -1)) {
                if (window.appData.scanning) {
                    handleScanInputRaw(v);
                    inp.value = '';
                }
            }
        });
    } catch(e){ console.error("bindScannerInput:", e) }
}

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

// ------------------- STARTUP -------------------
document.addEventListener('DOMContentLoaded', function(){
    try {
        initFirebaseRealtime();
    } catch(e) {
        console.error("startup error:", e);
        loadFromLocal();
        initializeUI();
    }
});
