/* app-logic.js
   Single-file logic for ProGlove Bowl Tracking System
   - Firebase Realtime DB (project: proglove-scanner) optional
   - Clean scan handling (kitchen + return)
   - Local fallback to localStorage if Firebase not available
   - Delivery JSON handler: handleNewDeliveryData(jsonData)
*/

// ------------------- GLOBAL STATE -------------------
window.appData = {
    mode: null,                // "kitchen" or "return"
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
    lastSync: null,
    lastDeliveryDate: null,
    deliveryDaysAgo: null,
    lastDeliveryCompany: null
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
var firebaseConfig = {
    apiKey: "AIzaSyCL3hffCHosBceIRGR1it2dYEDb3uxIrJw",
    authDomain: "proglove-scanner.firebaseapp.com",
    databaseURL: "https://proglove-scanner-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "proglove-scanner",
    storageBucket: "proglove-scanner.firebasestorage.app",
    messagingSenderId: "177575768177",
    appId: "1:177575768177:web:0a0acbf222218e0c0b2bd0"
};

// ------------------- UTILITIES -------------------
function showMessage(message, type, containerId = null) {
    try {
        const targetId = containerId || 'messageContainer'; // Use specific container or default to global
        var container = document.getElementById(targetId);
        if (!container) {
            console.log(`[${type||'info'}] (Container #${targetId} not found)`, message);
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

        // For section-specific messages, clear previous ones to avoid clutter
        if (containerId) {
            container.innerHTML = '';
        }

        container.appendChild(el);
        setTimeout(function() {
            try {
                if (el.parentNode === container) {
                    container.removeChild(el);
                }
            } catch(e){}
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
            lastSync: window.appData.lastSync,
            lastDeliveryDate: window.appData.lastDeliveryDate,
            deliveryDaysAgo: window.appData.deliveryDaysAgo,
            lastDeliveryCompany: window.appData.lastDeliveryCompany
        };
        localStorage.setItem('proglove_data_v1', JSON.stringify(toSave));
    } catch(e){ console.error("saveToLocal:", e) }
}

function loadFromLocal() {
    try {
        const raw = localStorage.getItem('proglove_data_v1');
        if (!raw) return;
        const parsed = JSON.parse(raw);
        return parsed;
    } catch(e){ console.error("loadFromLocal:", e); return null; }
}

function restoreState() {
    try {
        const data = loadFromLocal();
        if (!data) return;
        window.appData.activeBowls = data.activeBowls || [];
        window.appData.preparedBowls = data.preparedBowls || [];
        window.appData.returnedBowls = data.returnedBowls || [];
        window.appData.myScans = data.myScans || [];
        window.appData.scanHistory = data.scanHistory || [];
        window.appData.customerData = data.customerData || [];
        window.appData.lastSync = data.lastSync || null;
        window.appData.lastDeliveryDate = data.lastDeliveryDate || null;
        window.appData.deliveryDaysAgo = data.deliveryDaysAgo || null;
        window.appData.lastDeliveryCompany = data.lastDeliveryCompany || null;
    } catch(e){ console.error("restoreState:", e) }
}

// ------------------- FIREBASE (optional init) -------------------
var firebaseAvailable = false;
try {
    if (window.firebase && firebaseConfig) {
        try {
            if (!firebase.apps.length) {
                firebase.initializeApp(firebaseConfig);
            }
            firebaseAvailable = true;
            console.info("Firebase initialized.");
        } catch (e) {
            console.warn("Firebase init failed:", e);
            firebaseAvailable = false;
        }
    } else {
        console.info("Firebase SDK not present — falling back to localStorage only.");
    }
} catch (e) {
    console.warn("Firebase check error:", e);
    firebaseAvailable = false;
}

// Minimal sync functions (stubs you can expand)
function syncToFirebase(path, value) {
    if (!firebaseAvailable) {
        console.debug("Firebase not available — skipping sync:", path);
        return Promise.resolve(null);
    }
    try {
        return firebase.database().ref(path).set(value);
    } catch (e) {
        console.error("syncToFirebase error:", e);
        return Promise.reject(e);
    }
}

function fetchFromFirebase(path) {
    if (!firebaseAvailable) return Promise.resolve(null);
    return firebase.database().ref(path).once('value').then(s => s.val()).catch(e => { console.error(e); return null; });
}

// ------------------- BOWL HELPERS -------------------
function findActiveBowlByCode(code) {
    if (!code) return null;
    return window.appData.activeBowls.find(b => {
        if (!b.bowlCodes) return false;
        return b.bowlCodes.indexOf(code) !== -1;
    }) || null;
}

function addActiveBowl(bowl) {
    if (!bowl || !bowl.uniqueIdentifier) return;
    // avoid duplicates by uniqueIdentifier or code
    var exists = window.appData.activeBowls.find(b => b.uniqueIdentifier === bowl.uniqueIdentifier);
    if (exists) {
        // merge shallowly
        Object.assign(exists, bowl);
        return exists;
    } else {
        window.appData.activeBowls.push(bowl);
        return bowl;
    }
}

function markBowlReturned(bowlCode, returnMeta) {
    const bowl = findActiveBowlByCode(bowlCode);
    if (!bowl) {
        showMessage("Returned bowl not found in active list", "error", "scannerMessageContainer");
        return false;
    }
    bowl.returned = true;
    bowl.returnedAt = nowISO();
    bowl.returnMeta = returnMeta || {};
    // move to returnedBowls list
    window.appData.returnedBowls.push(bowl);
    // remove from activeBowls
    window.appData.activeBowls = window.appData.activeBowls.filter(b => b !== bowl);
    saveToLocal();
    return true;
}

// ------------------- SCAN HANDLING -------------------
// call this when a kitchen scan happens (prepare)
function handleScan(scanCode, user) {
    try {
        if (!scanCode) return;
        const found = findActiveBowlByCode(scanCode);
        if (found) {
            // already active -> increase prepared count or update
            found.prepared = true;
            found.preparedAt = nowISO();
            found.preparedBy = user || window.appData.user || 'unknown';
            showMessage(`Bowl ${scanCode} marked prepared`, 'success');
        } else {
            // create minimal bowl entry
            const newBowl = {
                uniqueIdentifier: `unknown-${scanCode}-${nowISO()}`,
                bowlCodes: [scanCode],
                deliveryDate: window.appData.lastDeliveryDate || null,
                createdAt: nowISO(),
                prepared: true,
                preparedAt: nowISO(),
                preparedBy: user || window.appData.user || 'unknown',
                returnExpected: true
            };
            addActiveBowl(newBowl);
            showMessage(`New active bowl added: ${scanCode}`, 'success');
        }
        // record scan
        window.appData.myScans = window.appData.myScans || [];
        window.appData.myScans.push({ code: scanCode, when: nowISO(), user: user || window.appData.user || null });
        window.appData.scanHistory = window.appData.scanHistory || [];
        window.appData.scanHistory.push({ type: 'prepare', code: scanCode, when: nowISO(), user: user || window.appData.user || null });
        saveToLocal();
        // try sync (non-blocking)
        if (firebaseAvailable) syncToFirebase('/activeBowls', window.appData.activeBowls).catch(()=>{});
    } catch (e) {
        console.error("handleScan error:", e);
        showMessage("Error processing scan", "error", "scannerMessageContainer");
    }
}

// call this when a return scanner scans a bowl
function handleReturnScan(scanCode, user) {
    try {
        const success = markBowlReturned(scanCode, { processedBy: user || window.appData.user || 'unknown' });
        if (success) {
            window.appData.scanHistory.push({ type: 'return', code: scanCode, when: nowISO(), user: user || window.appData.user || null });
            showMessage(`Bowl ${scanCode} returned`, 'success');
            // try sync
            if (firebaseAvailable) syncToFirebase('/returnedBowls', window.appData.returnedBowls).catch(()=>{});
        } else {
            // The error message is already shown inside markBowlReturned, no need for another one here.
            console.warn(`Return failed for code: ${scanCode}`);
        }
    } catch (e) {
        console.error("handleReturnScan error:", e);
    }
}

// ------------------- DELIVERY JSON HANDLER (manual call) -------------------
function handleNewDeliveryData(jsonData) {
    try {
        if (typeof jsonData !== 'object' || jsonData === null || !jsonData.boxes || !jsonData.boxes.length) {
            showMessage("Invalid delivery data format. Expected a JSON object with a 'boxes' array.", "error", "dataMessageContainer");
            return;
        }

        // Extract delivery date from uniqueIdentifier (example: cm-1-Minddistrict-2025-10-01)
        const uid = jsonData.boxes[0].uniqueIdentifier || "";
        const dateMatch = uid.match(/\d{4}-\d{2}-\d{2}/);

        // Default to today's date if not found
        const todayStr = new Date().toISOString().slice(0, 10);
        const deliveryDate = dateMatch ? dateMatch[0] : todayStr;

        // Calculate days since delivery
        const deliveryTime = new Date(deliveryDate + "T00:00:00").getTime();
        const todayTime = new Date().setHours(0, 0, 0, 0);
        const diffDays = Math.floor((todayTime - deliveryTime) / (1000 * 60 * 60 * 24));

        // Update appData with delivery info
        window.appData.lastDeliveryDate = deliveryDate;
        window.appData.deliveryDaysAgo = diffDays;
        window.appData.lastDeliveryCompany = jsonData.name || "Unknown";

        // Optional: Save to local storage for persistence
        saveToLocal();

        showMessage(
            `Delivery from ${window.appData.lastDeliveryCompany} on ${deliveryDate} (${diffDays} days ago) processed.`,
            "success"
        );

    } catch (e) {
        console.error("handleNewDeliveryData error:", e);
        showMessage("Error processing delivery data. Check console for details.", "error", "dataMessageContainer");
    }
}


// ------------------- BOOTSTRAP -------------------
(function boot() {
    restoreState();
    // additional initialization if needed
    console.info("App loaded. Active bowls:", window.appData.activeBowls.length || 0);
})();
