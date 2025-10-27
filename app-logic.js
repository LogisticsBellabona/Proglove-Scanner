// --- GLOBAL STATE, CONSTANTS & TYPES (MERGED) ---
const appState = {
    mode: null,
    currentUser: null,
    dishLetter: null,
    isScanning: false,
    systemStatus: 'initializing',
    appData: {
        activeBowls: [],
        preparedBowls: [],
        returnedBowls: [],
        myScans: [],
        scanHistory: [],
        customerData: [],
        lastSync: null,
    }
};

const USERS = [
    {name: "Hamid", role: "Kitchen"}, {name: "Ali", role: "Kitchen"},
    {name: "Jash", role: "Kitchen"}, {name: "Rafi", role: "Kitchen"},
    {name: "Mary", role: "Kitchen"}, {name: "Rushal", role: "Kitchen"},
    {name: "Sreekanth", role: "Kitchen"}, {name: "Ali", role: "Return"},
    {name: "Rafi", role: "Return"}, {name: "Said", role: "Return"},
    {name: "Mazher", role: "Return"}
];

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDya1dDRSeQmuKnpraSoSoTjauLlJ_J94I",
  authDomain: "proglove-bowl-tracker.firebaseapp.com",
  databaseURL: "https://proglove-bowl-tracker-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "proglove-bowl-tracker",
  storageBucket: "proglove-bowl-tracker.appspot.com",
  messagingSenderId: "280001054969",
  appId: "1:280001054969:web:a0792a228ea2f1c5c9ba28"
};

// --- UTILITIES (MERGED) ---
const todayDateStr = () => new Date().toISOString().slice(0, 10);
const nowISO = () => new Date().toISOString();
const nowTimeStr = () => new Date().toLocaleTimeString();

function showMessage(text, type) {
    const container = document.getElementById('messageContainer');
    if (!container) return;
    const el = document.createElement('div');
    const typeClasses = {
        success: 'bg-emerald-600',
        error: 'bg-red-600',
        info: 'bg-sky-600',
        warning: 'bg-amber-600',
    };
    el.className = `p-3 rounded-lg shadow-2xl text-white font-semibold ${typeClasses[type]} animate-fade-in-down`;
    el.innerText = text;
    container.appendChild(el);
    setTimeout(() => {
        try { container.removeChild(el); } catch(e){}
    }, 4000);
}

// --- DATA & FIREBASE SERVICE (MERGED) ---
let firebaseApp = null;
let syncTimeout = null;
let hasConnectedOnce = false;
const createDefaultAppData = () => ({
    activeBowls: [], preparedBowls: [], returnedBowls: [],
    myScans: [], scanHistory: [], customerData: [], lastSync: null,
});

function initFirebase() {
    try {
        if (typeof firebase === 'undefined' || !firebase.apps) {
            console.warn("Firebase not loaded."); return false;
        }
        if (!firebase.apps.length) {
            firebaseApp = firebase.initializeApp(FIREBASE_CONFIG);
        } else {
            firebaseApp = firebase.app();
        }
        return true;
    } catch (e) {
        console.error("Firebase initialization failed:", e); return false;
    }
}

function monitorFirebaseConnection(onConnected, onDisconnected) {
    if (!firebaseApp) return;
    const connectedRef = firebase.database().ref(".info/connected");
    connectedRef.on("value", (snap) => {
        if (snap.val() === true) { onConnected(); } else { onDisconnected(); }
    });
}

async function loadFromFirebase() {
    if (!firebaseApp) throw new Error("Firebase not initialized");
    const snapshot = await firebase.database().ref('progloveData').once('value');
    if (snapshot.exists()) {
        return { ...createDefaultAppData(), ...snapshot.val() };
    }
    return null; // Explicitly return null if no data exists
}

async function syncToFirebase(data) {
    if (!firebaseApp) throw new Error("Firebase not initialized");
    const now = new Date().toISOString();
    const payload = { ...data, lastSync: now };
    await firebase.database().ref('progloveData').set(payload);
    return now;
}

async function syncData() {
    if (appState.systemStatus !== 'online') {
        showMessage("Disconnected: Changes cannot be saved.", 'error');
        return;
    }
    clearTimeout(syncTimeout);
    syncTimeout = setTimeout(async () => {
        try {
            const syncTime = await syncToFirebase(appState.appData);
            appState.appData.lastSync = syncTime;
            updateUI();
            console.log("Data synced to Firebase at", syncTime);
        } catch (e) {
            console.error("Sync failed:", e);
            showMessage('Firebase sync failed!', 'error');
            appState.systemStatus = 'error';
            updateUI();
        }
    }, 500);
}


// --- EXPORT SERVICE (MERGED & FIXED) ---
async function exportData(type) {
    try {
        const { appData } = appState;
        if (type === 'active') {
            const activeBowls = (appData.activeBowls || []).filter(Boolean);
            if(activeBowls.length === 0) throw new Error("No active bowls to export.");
            const data = activeBowls.map(b => ({ "Bowl Code": b.code, "Dish": b.dish, "Company": b.company, "Customer": b.customer, "Creation Date": b.creationDate, "Missing Days": `${Math.ceil((new Date().getTime() - new Date(b.creationDate).getTime()) / 864e5)} days` }));
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.json_to_sheet(data);
            XLSX.utils.book_append_sheet(wb, ws, "Active Bowls");
            XLSX.writeFile(wb, "Active_Bowls.xlsx");
        } else if (type === 'returns') {
            const returnedBowls = (appData.returnedBowls || []).filter(Boolean);
            if(returnedBowls.length === 0) throw new Error("No returned bowls to export.");
            const data = returnedBowls.map(b => ({ "Bowl Code": b.code, "Dish": b.dish, "Company": b.company, "Customer": b.customer, "Returned By": b.user, "Return Date": b.returnDate, "Return Time": b.returnTime }));
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.json_to_sheet(data);
            XLSX.utils.book_append_sheet(wb, ws, "Returned Bowls");
            XLSX.writeFile(wb, "Returned_Bowls.xlsx");
        } else if (type === 'all') {
            await exportAllData(appData);
        }
        showMessage(`✅ Exported ${type} data successfully`, 'success');
    } catch (e) {
        showMessage(`❌ Export failed: ${e.message}`, 'error');
        console.error(e);
    }
}

async function exportAllData(appData) {
    if (typeof ExcelJS === 'undefined') throw new Error("ExcelJS library is not loaded.");
    
    const activeBowls = (appData.activeBowls || []).filter(Boolean);
    const preparedBowls = (appData.preparedBowls || []).filter(Boolean);
    const returnedBowls = (appData.returnedBowls || []).filter(Boolean);
    
    if (activeBowls.length === 0 && preparedBowls.length === 0 && returnedBowls.length === 0) {
      throw new Error("No data available to export.");
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'ProGlove Bowl Tracker';
    const headerFill = { type: 'pattern', pattern:'solid', fgColor:{argb:'FF1E293B'} };
    const headerFont = { color: { argb: 'FFFFFFFF' }, bold: true };

    if (activeBowls.length > 0) {
         const sheet = workbook.addWorksheet("Active Bowls");
         sheet.columns = [
            { header: "Bowl Code", key: "code", width: 30 }, { header: "Dish", key: "dish", width: 15 },
            { header: "Company", key: "company", width: 25 }, { header: "Customer", key: "customer", width: 25 },
            { header: "Creation Date", key: "creationDate", width: 20 }, { header: "Missing Days", key: "missingDays", width: 15 }
        ];
        sheet.getRow(1).fill = headerFill;
        sheet.getRow(1).font = headerFont;
        activeBowls.forEach(b => {
            const missingDays = Math.ceil((new Date().getTime() - new Date(b.creationDate).getTime()) / 864e5);
            sheet.addRow({ ...b, missingDays: `${missingDays} days` });
        });
    }
     if (returnedBowls.length > 0) {
        const sheet = workbook.addWorksheet("Returned Today");
        sheet.columns = [
            { header: "Bowl Code", key: "code", width: 30 }, { header: "Dish", key: "dish", width: 15 },
            { header: "Company", key: "company", width: 25 }, { header: "Customer", key: "customer", width: 25 },
            { header: "Returned By", key: "user", width: 20 }, { header: "Return Date", key: "returnDate", width: 20 },
            { header: "Return Time", key: "returnTime", width: 15 }
        ];
        sheet.getRow(1).fill = headerFill;
        sheet.getRow(1).font = headerFont;
        sheet.addRows(returnedBowls.filter(b => b.returnDate === todayDateStr()));
    }
    if (preparedBowls.length > 0) {
         const sheet = workbook.addWorksheet("Prepared Today");
        sheet.columns = [{ header: "Bowl Code", key: "code", width: 30 }, { header: "Dish", key: "dish", width: 15 }, { header: "User", key: "user", width: 20 }, { header: "Timestamp", key: "timestamp", width: 25 }];
        sheet.getRow(1).fill = headerFill;
        sheet.getRow(1).font = headerFont;
        sheet.addRows(preparedBowls.filter(b => b.creationDate === todayDateStr()));
    }
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `ProGlove_All_Data_${todayDateStr().replace(/\//g, '-')}.xlsx`;
    link.click();
    URL.revokeObjectURL(link.href);
}

// --- DOM ELEMENTS CACHE ---
const dom = {};
function cacheDOMElements() {
    const ids = [
        'systemStatus', 'kitchenModeBtn', 'returnModeBtn', 'modeStatus',
        'userSelect', 'dishSelectorContainer', 'dishSelect', 'startScanBtn',
        'stopScanBtn', 'scanInput', 'myScansDish', 'myScansCount',
        'preparedTodayCount', 'activeCount', 'returnedTodayCount',
        'livePrepReportBody', 'lastSyncInfo', 'jsonInput', 'patchResultContainer',
        'exportActiveBtn', 'exportReturnsBtn', 'exportAllBtn', 'patchJsonBtn', 'resetPreparedBtn'
    ];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) dom[id] = el;
    });
}

// --- UI UPDATE LOGIC ---
function updateUI() {
    if (!dom.systemStatus) return;
    const { mode, currentUser, dishLetter, isScanning, systemStatus, appData } = appState;
    
    const statusMap = {
        'initializing': { text: 'CONNECTING...', class: 'bg-gray-600' },
        'online': { text: 'ONLINE', class: 'bg-emerald-500' },
        'offline': { text: 'DISCONNECTED', class: 'bg-amber-500' },
        'error': { text: 'CONNECTION ERROR', class: 'bg-red-600' },
    };
    dom.systemStatus.textContent = statusMap[systemStatus]?.text || 'UNKNOWN';
    dom.systemStatus.className = `absolute right-4 top-4 px-3 py-1 rounded-full text-xs font-bold text-white ${statusMap[systemStatus]?.class}`;
    
    dom.kitchenModeBtn.classList.toggle('bg-pink-600', mode === 'kitchen');
    dom.kitchenModeBtn.classList.toggle('bg-slate-700', mode !== 'kitchen');
    dom.returnModeBtn.classList.toggle('bg-pink-600', mode === 'return');
    dom.returnModeBtn.classList.toggle('bg-slate-700', mode !== 'return');
    dom.modeStatus.textContent = mode ? `Mode selected: ${mode.toUpperCase()}` : 'Please select a mode';
    
    dom.userSelect.disabled = !mode;
    dom.dishSelectorContainer.style.display = (mode === 'kitchen') ? 'block' : 'none';
    dom.dishSelect.disabled = !(mode === 'kitchen' && !!currentUser);

    const isOnline = systemStatus === 'online';
    const canStartScan = (mode === 'kitchen' && !!currentUser && !!dishLetter) || (mode === 'return' && !!currentUser);
    
    dom.startScanBtn.disabled = !canStartScan || isScanning || !isOnline;
    dom.stopScanBtn.disabled = !isScanning;
    dom.patchJsonBtn.disabled = !isOnline;
    dom.resetPreparedBtn.disabled = !isOnline;

    const disconnectedTitle = "Cannot perform this action while disconnected.";
    dom.startScanBtn.title = !isOnline ? disconnectedTitle : "";
    dom.patchJsonBtn.title = !isOnline ? disconnectedTitle : "";
    dom.resetPreparedBtn.title = !isOnline ? disconnectedTitle : "";

    dom.scanInput.disabled = !isScanning;
    dom.scanInput.placeholder = isScanning ? "Awaiting scan..." : (canStartScan ? "Ready to scan" : "Select user/dish first...");
    
    const todayStr = todayDateStr();
    const preparedToday = (appData.preparedBowls || []).filter(b => b && b.creationDate === todayStr);
    const returnedToday = (appData.returnedBowls || []).filter(b => b && b.returnDate === todayStr);
    const myScansForUser = (appData.myScans || []).filter(s => s && s.user === currentUser);
    const myScansForDish = myScansForUser.filter(s => s.dish === dishLetter);
    
    dom.myScansCount.textContent = (mode === 'kitchen' && dishLetter) ? myScansForDish.length : myScansForUser.length;
    dom.myScansDish.textContent = (mode === 'kitchen' && dishLetter) ? dishLetter : '--';
    dom.preparedTodayCount.textContent = preparedToday.length;
    dom.activeCount.textContent = (appData.activeBowls || []).filter(Boolean).length;
    dom.returnedTodayCount.textContent = returnedToday.length;
    
    const prepReport = preparedToday.reduce((acc, bowl) => {
        const key = `${bowl.dish}__${bowl.user}`;
        if (!acc[key]) acc[key] = { dish: bowl.dish, user: bowl.user, count: 0 };
        acc[key].count++;
        return acc;
    }, {});

    const sortedReport = Object.values(prepReport).sort((a,b) => a.dish.localeCompare(b.dish) || a.user.localeCompare(b.user));
    dom.livePrepReportBody.innerHTML = sortedReport.length > 0 ? sortedReport.map(row => `
        <tr class="border-b border-slate-700 hover:bg-slate-700/50">
            <td class="p-2 font-bold">${row.dish}</td><td class="p-2">${row.user}</td>
            <td class="p-2 text-lg font-mono text-pink-400">${row.count}</td>
        </tr>`).join('') : `<tr><td colspan="3" class="p-4 text-center text-slate-400">No bowls prepared today.</td></tr>`;

    dom.lastSyncInfo.textContent = appData.lastSync ? new Date(appData.lastSync).toLocaleString() : 'N/A';
}

// --- CORE LOGIC ---
async function handleScan(code) {
    if (!code) return;
    const { mode, currentUser, dishLetter, appData } = appState;
    
    dom.scanInput.disabled = true;
    setTimeout(() => { if (appState.isScanning) { dom.scanInput.disabled = false; dom.scanInput.focus(); } }, 500);
    
    const scanHistoryEntry = { code, user: currentUser, mode, timestamp: nowISO() };

    if (mode === 'kitchen') {
        const activeBowlIndex = appData.activeBowls.findIndex(b => b && b.code === code);

        if (activeBowlIndex !== -1) {
            appState.appData.activeBowls.splice(activeBowlIndex, 1);
        }

        const preparedBowlIndex = appData.preparedBowls.findIndex(b => b && b.code === code && b.creationDate === todayDateStr());
        if (preparedBowlIndex !== -1) {
             appData.preparedBowls.splice(preparedBowlIndex, 1);
        }
        
        const customer = appData.customerData.find(c => c.bowl_id === code) || {};
        const newBowl = {
            code, dish: dishLetter, user: currentUser,
            company: customer.company || 'N/A', customer: customer.customer_name || 'N/A',
            creationDate: todayDateStr(), timestamp: nowISO()
        };
        appData.activeBowls.push(newBowl);
        appData.preparedBowls.push(newBowl);
        appData.myScans.push({ user: currentUser, dish: dishLetter, code });

        if (activeBowlIndex !== -1) {
            showMessage(`✅ Bowl ${code} re-prepared for Dish ${dishLetter}.`, 'success');
        } else {
            showMessage(`✅ Prep scan OK: ${code} for Dish ${dishLetter}`, 'success');
        }
    } else if (mode === 'return') {
        const bowlIndex = appData.activeBowls.findIndex(b => b && b.code === code);
        if (bowlIndex === -1) {
            showMessage(`Bowl ${code} not found in active list`, 'error');
        } else {
            const [returnedBowl] = appData.activeBowls.splice(bowlIndex, 1);
            const updatedBowl = {...returnedBowl, returnDate: todayDateStr(), returnTime: nowTimeStr(), user: currentUser };
            appData.returnedBowls.push(updatedBowl);
            appData.myScans.push({ user: currentUser, code });
            showMessage(`🔄 Return scan OK: ${code}`, 'success');
        }
    }

    appData.scanHistory.push(scanHistoryEntry);
    await syncData();
    updateUI();
    dom.scanInput.value = '';
}

function populateDropdowns() {
    const { mode } = appState;
    const userRoleFilter = (user) => !mode ? false : (mode === 'kitchen' && user.role === 'Kitchen') || (mode === 'return' && user.role === 'Return');
    dom.userSelect.innerHTML = '<option value="">-- Select User --</option>' + USERS.filter(userRoleFilter).map(u => `<option value="${u.name}">${u.name}</option>`).join('');
    
    const dishes = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', ...'1234'];
    dom.dishSelect.innerHTML = '<option value="">-- Select Dish --</option>' + dishes.map(d => `<option value="${d}">${d}</option>`).join('');
}


// --- EVENT HANDLERS ---
function setMode(mode) {
    stopScanning();
    appState.mode = mode;
    appState.currentUser = null;
    appState.dishLetter = null;
    populateDropdowns();
    dom.userSelect.value = '';
    dom.dishSelect.value = '';
    updateUI();
}

function selectUser() {
    appState.currentUser = dom.userSelect.value;
    updateUI();
}

function selectDishLetter() {
    appState.dishLetter = dom.dishSelect.value;
    updateUI();
}

function startScanning() {
    appState.isScanning = true;
    updateUI();
    dom.scanInput.focus();
}

function stopScanning() {
    appState.isScanning = false;
    dom.scanInput.value = '';
    updateUI();
}

async function processJsonPatch() {
    const jsonText = dom.jsonInput.value.trim();
    if (!jsonText) return showMessage('JSON input is empty.', 'warning');

    const patchResultContainer = dom.patchResultContainer;
    const showResult = (message, type) => {
        const classMap = {
            error: 'bg-red-800/50 text-red-300',
            success: 'bg-emerald-800/50 text-emerald-300',
        };
        patchResultContainer.className = `mt-4 p-3 rounded-lg text-sm ${classMap[type]}`;
        patchResultContainer.innerHTML = message;
        patchResultContainer.style.display = 'block';
    };

    let companiesData;
    try {
        const parsed = JSON.parse(jsonText);
        // Handle both a single company object or an array of them at the root
        companiesData = Array.isArray(parsed) ? parsed : [parsed];
    } catch (e) {
        return showResult('❌ Error: Could not parse JSON. Please check for syntax errors.', 'error');
    }

    let createdCount = 0;
    let updatedCount = 0;
    const today = todayDateStr();

    companiesData.forEach(company => {
        if (!company || typeof company !== 'object' || !Array.isArray(company.boxes)) {
            return; // Skip invalid company entries
        }

        const companyName = company.name || 'N/A';

        company.boxes.forEach(box => {
            if (!box || !Array.isArray(box.dishes)) {
                return; // Skip invalid box entries
            }

            let deliveryDate = today;
            if (box.uniqueIdentifier) {
                const dateMatch = box.uniqueIdentifier.match(/\d{4}-\d{2}-\d{2}/);
                if (dateMatch) {
                    deliveryDate = dateMatch[0];
                }
            }

            box.dishes.forEach(dish => {
                if (!dish || !Array.isArray(dish.bowlCodes)) {
                    return; // Skip invalid dish entries
                }

                const customers = (dish.users && dish.users.length > 0)
                    ? dish.users.map(u => u.username).join(', ')
                    : 'N/A';

                dish.bowlCodes.forEach(code => {
                    if (!code) return;

                    const existingBowl = appState.appData.activeBowls.find(b => b && b.code === code);

                    if (existingBowl) {
                        // Update existing bowl
                        existingBowl.company = companyName;
                        existingBowl.customer = customers;
                        existingBowl.creationDate = deliveryDate;
                        updatedCount++;
                    } else {
                        // Create new bowl and add to active list
                        const newBowl = {
                            code: code,
                            dish: dish.label || 'N/A',
                            company: companyName,
                            customer: customers,
                            creationDate: deliveryDate,
                            timestamp: nowISO(),
                        };
                        appState.appData.activeBowls.push(newBowl);
                        createdCount++;
                    }
                });
            });
        });
    });

    if (createdCount === 0 && updatedCount === 0) {
        return showResult("⚠️ Warning: No valid bowl codes were found in the provided JSON data. Please check the data structure.", 'error');
    }

    await syncData();

    let resultMessage = `✅ JSON processed successfully.<br>`;
    resultMessage += `✨ Created <strong>${createdCount}</strong> new bowl record(s).<br>`;
    resultMessage += `🔄 Updated <strong>${updatedCount}</strong> existing bowl record(s).`;
    
    showResult(resultMessage, 'success');
    dom.jsonInput.value = '';
    showMessage('Customer data applied successfully!', 'success');
    updateUI();
}

async function resetPrepared() {
    if (confirm("Are you sure you want to reset ALL prepared bowls and scan counts for THIS 10 PM CYCLE? This cannot be undone.")) {
        const todayStr = todayDateStr();
        appState.appData.preparedBowls = appState.appData.preparedBowls.filter(b => b.creationDate !== todayStr);
        appState.appData.myScans = []; // Assuming myScans is also for the current day cycle
        await syncData();
        updateUI();
        showMessage('Prepared data for today has been reset.', 'info');
    }
}

// --- EVENT LISTENER SETUP ---
function initEventListeners() {
    dom.kitchenModeBtn.addEventListener('click', () => setMode('kitchen'));
    dom.returnModeBtn.addEventListener('click', () => setMode('return'));
    dom.userSelect.addEventListener('change', selectUser);
    dom.dishSelect.addEventListener('change', selectDishLetter);
    dom.startScanBtn.addEventListener('click', startScanning);
    dom.stopScanBtn.addEventListener('click', stopScanning);

    dom.exportActiveBtn.addEventListener('click', () => exportData('active'));
    dom.exportReturnsBtn.addEventListener('click', () => exportData('returns'));
    dom.exportAllBtn.addEventListener('click', () => exportData('all'));

    dom.patchJsonBtn.addEventListener('click', processJsonPatch);
    dom.resetPreparedBtn.addEventListener('click', resetPrepared);
    
    dom.scanInput.addEventListener('change', (e) => handleScan(e.target.value.trim()));
}


// --- INITIALIZATION ---
async function initializeApp() {
    cacheDOMElements();
    initEventListeners();
    appState.appData = createDefaultAppData();
    updateUI(); 

    if (initFirebase()) {
        monitorFirebaseConnection(
            async () => { // onConnected
                if (!hasConnectedOnce) {
                    appState.systemStatus = 'online';
                    hasConnectedOnce = true;
                    try {
                        const firebaseData = await loadFromFirebase();
                        if (firebaseData) {
                            appState.appData = firebaseData;
                            showMessage('Data loaded from Firebase.', 'info');
                        } else {
                            appState.appData = createDefaultAppData();
                            showMessage('Firebase is empty. Starting fresh.', 'info');
                        }
                    } catch (e) {
                        console.error("Failed to load from Firebase:", e);
                        appState.systemStatus = 'error';
                    }
                    updateUI();
                } else {
                    appState.systemStatus = 'online';
                    updateUI();
                }
            },
            () => { // onDisconnected
                if (hasConnectedOnce) {
                    appState.systemStatus = 'offline';
                    showMessage('Connection lost. Changes are disabled until reconnected.', 'warning');
                    updateUI();
                }
            }
        );
    } else {
        appState.systemStatus = 'offline';
        showMessage('Could not connect to Firebase. App is in read-only mode.', 'error');
        updateUI();
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}
