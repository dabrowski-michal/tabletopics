'use strict';

/* ============================================================
   Speaking Elephants — Table Topics Board
   Sections: state · helpers · question sets · admin panel ·
   board · tile FX · stage flight ·
   modals · voting · winner ceremony · certificate generator
   ============================================================ */

/* ---------------- State ---------------- */

let allTopics = [];
let selectionHistory = [];
let cardsRenderedCount = 0;
let actualWinnerName = '';

let certificateData = [];
let currentCertIndex = 0;
let certExportDate = '';

let stageActive = false;
let stageBusy = false;
let stageOpenTl = null;
let originTile = null;

let armedSpeaker = null;      // speaker waiting to pick a card
let currentSpeakerName = '';  // last speaker, shown in the top-bar speaker unit

/* Question sets — stored in the server database (/api/sets), managed from the Admin Panel */
const SET_SIZES = [10, 15, 20];

let questionSets = [];      // [{ id, name, questions: [{ text }], updatedAt }]
let activeSetId = '';
let boardSetStamp = '';     // id|updatedAt of the set currently rendered on the board
let adminDraft = null;      // working copy in the editor: { id|null, name, questions }
let adminDirty = false;
let adminBusy = false;      // a save to the database is in flight

const PASS_KEY = 'tableTopics.pass';   // sessionStorage: survives a reload, not a closed tab
let appPassword = '';
const SAVE_FAILED = 'Could not reach the database. Check the connection and try again.';


const FIREWORK_COLORS = ['#F2DF74', '#FFFFFF', '#A9B2B1', '#006094', '#781327', '#772432'];

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const dur = t => (reducedMotion ? 0.01 : t);

/* ---------------- DOM refs ---------------- */

const $ = id => document.getElementById(id);

const board = $('board');
const setNote = $('setNote');

const adminToggle = $('adminToggle');
const adminSetList = $('adminSetList');
const adminListMsg = $('adminListMsg');
const adminForm = $('adminForm');
const adminEditorEmpty = $('adminEditorEmpty');
const adminEditorEyebrow = $('adminEditorEyebrow');
const adminSetName = $('adminSetName');
const adminQList = $('adminQList');
const adminCount = $('adminCount');
const adminAddBtn = $('adminAddBtn');
const adminRemoveBtn = $('adminRemoveBtn');
const adminEditorMsg = $('adminEditorMsg');
const adminPanel = $('adminPanel');

const loginScreen = $('loginScreen');
const loginForm = $('loginForm');
const loginPassword = $('loginPassword');
const loginMsg = $('loginMsg');
const loginBtn = $('loginBtn');

const stageVeil = $('stageVeil');
const stageCard = $('stageCard');
const stageContent = $('stageContent');
const stageKeyword = $('stageKeyword');
const stageQuestion = $('stageQuestion');
const stageSpeaker = $('stageSpeaker');
const stageSealL = $('stageSealL');
const stageSealR = $('stageSealR');
const stageCloseBtn = $('stageCloseBtn');
const curtainLeft = $('curtainLeft');
const curtainRight = $('curtainRight');
const ffCanvas = $('stageParticles');
const ffCtx = ffCanvas.getContext('2d');

const stageWash = $('stageWash');
const stageMaxTime = $('stageMaxTime');
const startSpeechBtn = $('startSpeechBtn');
const stageCounter = $('stageCounter');
const stageCounterLabel = $('stageCounterLabel');
const stageCounterDigits = $('stageCounterDigits');
const tlFill = $('tlFill');
const tlHead = $('tlHead');

const nameModal = $('nameModal');
const bigSpeakerInput = $('bigSpeakerInput');
const nextSpeakerBtn = $('nextSpeakerBtn');
const currentSpeakerNameEl = $('currentSpeakerName');
const settingsDrawer = $('settingsDrawer');
const drawerVeil = $('drawerVeil');

const listModal = $('listModal');
const orderList = $('orderList');

const winnerModal = $('winnerModal');
const winnerModalContainer = $('winnerModalContainer');
const winnerInput = $('winnerInput');
const winnerCertScaler = $('winnerCertScaler');
const winnerCertFit = $('winnerCertFit');
const wfxCanvas = $('winnerFxCanvas');
const wfxCtx = wfxCanvas.getContext('2d');

const generatorModal = $('generatorModal');
const genCertScaler = $('genCertScaler');
const genCertFit = $('genCertFit');
const fwCanvas = $('fireworksCanvas');
const fwCtx = fwCanvas.getContext('2d');

/* ---------------- Helpers ---------------- */

function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function openModal(modal) { modal.classList.add('show'); }
function closeModal(modal) { modal.classList.remove('show'); }

function formatToday() {
    return new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

/* "7. How do you…" / "7) How do you…" → "How do you…" */
function stripQuestionNumber(text) {
    return String(text).replace(/^\s*\d+\s*[.)\-:]?\s*/, '');
}

/* ---------------- Question sets: model + persistence ---------------- */

function newSetId() {
    return 'set-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

function emptyQuestions(count) {
    return Array.from({ length: count }, () => ({ text: '' }));
}

/* Coerces unknown data (storage, import) into { name, questions } or null */
function normalizeSet(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.questions)) return null;
    return {
        name: String(raw.name == null ? '' : raw.name).trim(),
        questions: raw.questions.map(q => ({
            text: String(q && q.text != null ? q.text : '').trim()
        }))
    };
}

/* Returns { ok, nameMissing, sizeInvalid, badRows: [index], messages: [string] } */
function validateSet(set) {
    const nameMissing = !set.name.trim();
    const sizeInvalid = !SET_SIZES.includes(set.questions.length);
    const badRows = [];
    set.questions.forEach((q, i) => {
        if (!q.text.trim()) badRows.push(i);
    });

    const messages = [];
    if (nameMissing) messages.push('Set name is required.');
    if (sizeInvalid) messages.push('A set must have 10, 15 or 20 questions.');
    if (badRows.length) {
        messages.push(
            (badRows.length === 1 ? 'Question ' : 'Questions ') +
            badRows.map(i => i + 1).join(', ') +
            (badRows.length === 1 ? ' is' : ' are') +
            ' empty.'
        );
    }
    return { ok: messages.length === 0, nameMissing, sizeInvalid, badRows, messages };
}



async function apiSets(method, body) {
    const headers = { 'X-App-Password': appPassword };
    if (body) headers['Content-Type'] = 'application/json';
    const response = await fetch('/api/sets', {
        method,
        headers,
        cache: 'no-store',
        body: body ? JSON.stringify(body) : undefined
    });
    if (!response.ok) {
        const err = new Error('Sets request failed');
        err.status = response.status;
        throw err;
    }
    return response.json();
}

function adoptSetsDoc(doc) {
    const sets = [];
    (doc && Array.isArray(doc.sets) ? doc.sets : []).forEach(raw => {
        const set = normalizeSet(raw);
        if (!set || !validateSet(set).ok) return;
        set.id = typeof raw.id === 'string' && raw.id ? raw.id : newSetId();
        set.updatedAt = Number(raw.updatedAt) || 0;
        sets.push(set);
    });
    if (sets.length === 0) throw new Error('The database returned no usable sets');
    questionSets = sets;
    activeSetId = sets.some(s => s.id === doc.activeSetId) ? doc.activeSetId : sets[0].id;
}

async function loadSets() {
    adoptSetsDoc(await apiSets('GET'));
}

function setsSnapshot() {
    return { sets: questionSets.slice(), activeSetId };
}

/* Writes the whole collection to the database. On failure the in-memory state
   is rolled back to `previous` (from setsSnapshot) and false is returned. */
async function saveSets(previous) {
    adminBusy = true;
    adminPanel.classList.add('is-busy');
    let ok = true;
    try {
        await apiSets('PUT', { sets: questionSets, activeSetId });
    } catch (e) {
        questionSets = previous.sets;
        activeSetId = previous.activeSetId;
        ok = false;
    }
    adminBusy = false;
    adminPanel.classList.remove('is-busy');
    return ok;
}

function getActiveSet() {
    return questionSets.find(s => s.id === activeSetId) || questionSets[0];
}

function setStamp(set) {
    return set.id + '|' + set.updatedAt;
}

/* Puts the active set on the board (resets the running game) */
function applyActiveSet() {
    const set = getActiveSet();
    allTopics = set.questions.map(q => ({ text: q.text }));
    boardSetStamp = setStamp(set);
    setNote.textContent = 'Set: ' + set.name + ' · ' + set.questions.length + ' questions';
    clearAndInitBoard();
}

/* ---------------- Login ---------------- */

/* The server checks the password; a correct one returns the question sets */
async function tryLogin(password) {
    appPassword = password;
    await loadSets();
    try { sessionStorage.setItem(PASS_KEY, password); } catch (e) { /* private mode — ask again next time */ }
    loginPassword.value = '';
    loginScreen.classList.add('is-hidden');
    applyActiveSet();
}

async function submitLogin() {
    const password = loginPassword.value;
    if (!password) {
        showAdminMsg(loginMsg, 'Enter the password.', 'error');
        loginPassword.focus();
        return;
    }
    loginBtn.disabled = true;
    hideAdminMsg(loginMsg);
    try {
        await tryLogin(password);
    } catch (err) {
        appPassword = '';
        showAdminMsg(
            loginMsg,
            err.status === 401 ? 'Wrong password. Try again.' : 'Cannot reach the server. Check the connection and try again.',
            'error'
        );
        loginPassword.select();
    }
    loginBtn.disabled = false;
}

async function startSession() {
    let remembered = '';
    try { remembered = sessionStorage.getItem(PASS_KEY) || ''; } catch (e) { /* ignore */ }
    if (remembered) {
        try {
            await tryLogin(remembered);
            return;
        } catch (e) {
            appPassword = '';
            try { sessionStorage.removeItem(PASS_KEY); } catch (e2) { /* ignore */ }
        }
    }
    loginForm.hidden = false;
    loginPassword.focus();
}

/* ---------------- Admin panel ---------------- */

function isAdminMode() {
    return document.body.classList.contains('admin-mode');
}

function showAdminMsg(el, text, kind) {
    el.textContent = text;
    el.className = 'admin-msg admin-msg-' + kind;
    el.hidden = false;
}

function hideAdminMsg(el) {
    el.hidden = true;
    el.textContent = '';
}

function confirmDiscardDraft() {
    return !adminDirty || confirm('Discard unsaved changes to this set?');
}

/* Returns true when the mode ended up as requested */
function setAdminMode(on) {
    if (on === isAdminMode()) {
        adminToggle.checked = on;
        return true;
    }

    if (adminBusy) {
        adminToggle.checked = isAdminMode();
        return false;
    }

    if (on) {
        // The stage measures its origin tile — never hide the board mid-reveal
        if (stageActive || stageBusy || document.querySelector('.modal.show')) {
            adminToggle.checked = false;
            alert('Close the open card or window before opening the Admin Panel.');
            return false;
        }
        adminDraft = null;
        adminDirty = false;
        hideAdminMsg(adminListMsg);
        renderAdminList();
        renderAdminEditor();
        document.body.classList.add('admin-mode');
    } else {
        if (!confirmDiscardDraft()) {
            adminToggle.checked = true;
            return false;
        }
        adminDraft = null;
        adminDirty = false;
        document.body.classList.remove('admin-mode');
        // Only reset the board when the loaded set (or its content) actually changed
        if (setStamp(getActiveSet()) !== boardSetStamp) applyActiveSet();
    }

    adminToggle.checked = on;
    closeDrawer();
    return true;
}

function renderAdminList() {
    const onlyOne = questionSets.length < 2;
    adminSetList.innerHTML = questionSets.map(set => {
        const active = set.id === activeSetId;
        const editing = adminDraft && adminDraft.id === set.id;
        return '<li class="admin-set' + (active ? ' is-active' : '') + (editing ? ' is-editing' : '') +
            '" data-id="' + escapeHTML(set.id) + '">' +
            '<div class="admin-set-main">' +
                '<span class="admin-set-name">' + escapeHTML(set.name) + '</span>' +
                '<span class="admin-set-meta">' + set.questions.length + ' questions' +
                    (active ? ' · <span class="admin-badge">Loaded</span>' : '') + '</span>' +
            '</div>' +
            '<div class="admin-set-actions">' +
                '<button type="button" class="admin-mini" data-act="load"' + (active ? ' disabled' : '') + '>Load</button>' +
                '<button type="button" class="admin-mini" data-act="edit">Edit</button>' +
                '<button type="button" class="admin-mini admin-mini-danger" data-act="delete"' +
                    (onlyOne ? ' disabled title="At least one set must remain"' : '') + '>Delete</button>' +
            '</div>' +
        '</li>';
    }).join('');
}

function renderAdminEditor() {
    hideAdminMsg(adminEditorMsg);
    if (!adminDraft) {
        adminForm.hidden = true;
        adminEditorEmpty.hidden = false;
        return;
    }
    adminEditorEmpty.hidden = true;
    adminForm.hidden = false;
    adminEditorEyebrow.textContent = adminDraft.id ? 'Editing set' : 'New set';
    adminSetName.value = adminDraft.name;
    adminSetName.classList.remove('is-invalid');
    renderAdminQuestions();
}

function renderAdminQuestions() {
    adminQList.innerHTML = adminDraft.questions.map((q, i) => {
        const n = i + 1;
        return '<div class="admin-qrow" data-i="' + i + '">' +
            '<span class="admin-qnum">' + n + '</span>' +
            '<textarea class="admin-field admin-qtext" rows="2" maxlength="240" placeholder="Question" aria-label="Question ' + n + '">' +
                escapeHTML(q.text) + '</textarea>' +
        '</div>';
    }).join('');
    updateAdminSizeControls();
}

function updateAdminSizeControls() {
    const count = adminDraft.questions.length;
    adminCount.textContent = count + ' / 20 questions';
    adminAddBtn.disabled = count >= 20;
    adminRemoveBtn.disabled = count <= 10;
}

function openAdminEditor(set) {
    if (!confirmDiscardDraft()) return;
    adminDraft = set
        ? { id: set.id, name: set.name, questions: set.questions.map(q => ({ text: q.text })) }
        : { id: null, name: '', questions: emptyQuestions(10) };
    adminDirty = false;
    hideAdminMsg(adminListMsg);
    renderAdminList();
    renderAdminEditor();
    adminSetName.focus();
}

function closeAdminEditor() {
    if (!confirmDiscardDraft()) return;
    adminDraft = null;
    adminDirty = false;
    renderAdminList();
    renderAdminEditor();
}

function resizeAdminDraft(delta) {
    const count = adminDraft.questions.length;
    const target = count + delta;
    if (target < 10 || target > 20) return;

    if (delta > 0) {
        adminDraft.questions.push(...emptyQuestions(delta));
    } else {
        const tail = adminDraft.questions.slice(target);
        const hasContent = tail.some(q => q.text.trim());
        if (hasContent && !confirm('Questions ' + (target + 1) + '–' + count + ' contain text. Remove them?')) return;
        adminDraft.questions.length = target;
    }
    adminDirty = true;
    hideAdminMsg(adminEditorMsg);
    renderAdminQuestions();
    if (delta > 0) {
        const firstNew = adminQList.querySelector('.admin-qrow[data-i="' + count + '"] .admin-qtext');
        if (firstNew) {
            firstNew.scrollIntoView({ block: 'nearest' });
            firstNew.focus();
        }
    }
}

async function saveAdminDraft() {
    if (adminBusy) return;
    const cleaned = normalizeSet(adminDraft);
    const result = validateSet(cleaned);

    adminSetName.classList.toggle('is-invalid', result.nameMissing);
    adminQList.querySelectorAll('.admin-qrow').forEach((row, i) => {
        row.querySelector('.admin-qtext').classList.toggle('is-invalid', !cleaned.questions[i].text);
    });

    if (!result.ok) {
        showAdminMsg(adminEditorMsg, 'Not saved. ' + result.messages.join(' '), 'error');
        const firstBad = adminForm.querySelector('.is-invalid');
        if (firstBad) firstBad.focus();
        return;
    }

    const previous = setsSnapshot();
    const existing = adminDraft.id && questionSets.find(s => s.id === adminDraft.id);
    const saved = {
        id: existing ? existing.id : newSetId(),
        name: cleaned.name,
        questions: cleaned.questions,
        updatedAt: Date.now()
    };
    questionSets = existing
        ? questionSets.map(s => (s.id === saved.id ? saved : s))
        : questionSets.concat(saved);

    if (!(await saveSets(previous))) {
        showAdminMsg(adminEditorMsg, 'Not saved. ' + SAVE_FAILED, 'error');
        return;
    }

    adminDraft = { id: saved.id, name: saved.name, questions: saved.questions.map(q => ({ text: q.text })) };
    adminDirty = false;
    renderAdminList();
    renderAdminEditor();
    showAdminMsg(
        adminEditorMsg,
        saved.id === activeSetId
            ? 'Set saved. The board will refresh when you leave the Admin Panel.'
            : 'Set saved. Press Load in the list to use it on the board.',
        'ok'
    );
}

async function loadAdminSet(set) {
    if (adminBusy) return;
    const previous = setsSnapshot();
    activeSetId = set.id;
    const ok = await saveSets(previous);
    renderAdminList();
    if (!ok) {
        showAdminMsg(adminListMsg, 'Not loaded. ' + SAVE_FAILED, 'error');
        return;
    }
    // Loading a set also opens it in the editor
    if (!adminDraft || adminDraft.id !== set.id) openAdminEditor(set);
    showAdminMsg(adminListMsg, '"' + set.name + '" is loaded. It appears on the board when you leave the Admin Panel.', 'ok');
}

async function deleteAdminSet(set) {
    if (adminBusy || questionSets.length < 2) return;
    if (!confirm('Delete the set "' + set.name + '"? This cannot be undone.')) return;

    const previous = setsSnapshot();
    questionSets = questionSets.filter(s => s.id !== set.id);
    if (activeSetId === set.id) activeSetId = questionSets[0].id;

    if (!(await saveSets(previous))) {
        renderAdminList();
        showAdminMsg(adminListMsg, 'Not deleted. ' + SAVE_FAILED, 'error');
        return;
    }

    if (adminDraft && adminDraft.id === set.id) {
        adminDraft = null;
        adminDirty = false;
        renderAdminEditor();
    }
    renderAdminList();
    showAdminMsg(adminListMsg, '"' + set.name + '" was deleted.', 'ok');
}

function exportSets() {
    const payload = {
        app: 'table-topics',
        version: 1,
        sets: questionSets.map(s => ({ name: s.name, questions: s.questions }))
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'table-topics-sets-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showAdminMsg(adminListMsg, questionSets.length + (questionSets.length === 1 ? ' set' : ' sets') + ' exported.', 'ok');
}

async function importSetsFromText(text) {
    if (adminBusy) return;
    let data;
    try {
        data = JSON.parse(text);
    } catch (e) {
        showAdminMsg(adminListMsg, 'Import failed. The file is not valid JSON.', 'error');
        return;
    }

    const candidates = Array.isArray(data) ? data
        : (data && Array.isArray(data.sets)) ? data.sets
        : [data];

    const previous = setsSnapshot();
    const merged = questionSets.slice();
    let added = 0;
    let skipped = 0;
    candidates.forEach(raw => {
        const set = normalizeSet(raw);
        if (!set || !validateSet(set).ok) { skipped++; return; }
        while (merged.some(s => s.name === set.name)) set.name += ' (imported)';
        set.id = newSetId();
        set.updatedAt = Date.now();
        merged.push(set);
        added++;
    });

    if (added === 0) {
        showAdminMsg(adminListMsg, 'Import failed. No valid sets found (each needs a name and 10, 15 or 20 questions).', 'error');
        return;
    }

    questionSets = merged;
    const ok = await saveSets(previous);
    renderAdminList();
    if (!ok) {
        showAdminMsg(adminListMsg, 'Import failed. ' + SAVE_FAILED, 'error');
        return;
    }
    showAdminMsg(
        adminListMsg,
        added + (added === 1 ? ' set' : ' sets') + ' imported' +
            (skipped ? ', ' + skipped + ' skipped as incomplete.' : '.'),
        'ok'
    );
}

function handleSetsImport(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => importSetsFromText(String(e.target.result));
    reader.onerror = () => showAdminMsg(adminListMsg, 'Import failed. The file could not be read.', 'error');
    reader.readAsText(file);
    input.value = '';
}

function initAdminPanel() {
    adminToggle.addEventListener('change', () => setAdminMode(adminToggle.checked));
    $('adminExitBtn').addEventListener('click', () => setAdminMode(false));

    adminSetList.addEventListener('click', e => {
        const btn = e.target.closest('button[data-act]');
        if (!btn) return;
        const set = questionSets.find(s => s.id === btn.closest('.admin-set').dataset.id);
        if (!set) return;
        if (btn.dataset.act === 'load') loadAdminSet(set);
        else if (btn.dataset.act === 'edit') openAdminEditor(set);
        else if (btn.dataset.act === 'delete') deleteAdminSet(set);
    });

    $('adminNewBtn').addEventListener('click', () => openAdminEditor(null));
    $('adminExportBtn').addEventListener('click', exportSets);
    $('adminImportBtn').addEventListener('click', () => $('setsImportInput').click());
    $('setsImportInput').addEventListener('change', e => handleSetsImport(e.target));

    adminSetName.addEventListener('input', () => {
        adminDraft.name = adminSetName.value;
        adminDirty = true;
        adminSetName.classList.remove('is-invalid');
    });
    adminQList.addEventListener('input', e => {
        const row = e.target.closest('.admin-qrow');
        if (!row) return;
        adminDraft.questions[Number(row.dataset.i)].text = e.target.value;
        adminDirty = true;
        e.target.classList.remove('is-invalid');
    });
    // Enter in a question box moves to the next question instead of inserting a line break
    adminQList.addEventListener('keydown', e => {
        if (e.key === 'Enter' && e.target.classList.contains('admin-qtext')) {
            e.preventDefault();
            const next = e.target.closest('.admin-qrow').nextElementSibling;
            if (next) next.querySelector('.admin-qtext').focus();
        }
    });

    adminAddBtn.addEventListener('click', () => resizeAdminDraft(5));
    adminRemoveBtn.addEventListener('click', () => resizeAdminDraft(-5));
    $('adminCancelBtn').addEventListener('click', closeAdminEditor);
    adminForm.addEventListener('submit', e => {
        e.preventDefault();
        saveAdminDraft();
    });

    window.addEventListener('beforeunload', e => {
        if (isAdminMode() && adminDirty) {
            e.preventDefault();
            e.returnValue = '';
        }
    });
}

/* ---------------- Board rendering ---------------- */

function clearAndInitBoard() {
    selectionHistory = [];
    cardsRenderedCount = 0;
    armedSpeaker = null;
    currentSpeakerName = '';
    currentSpeakerNameEl.textContent = '';
    updateBoardLock();
    board.innerHTML = '';
    renderNextBatch();
}

function renderNextBatch() {
    const start = cardsRenderedCount;
    const batchEnd = allTopics.length;   // every question of the set gets a tile at once
    const newTiles = [];

    for (let i = start; i < batchEnd; i++) {
        const n = i + 1;
        const tile = document.createElement('div');
        tile.className = 'tile';
        tile.id = 'tile-' + n;
        tile.setAttribute('role', 'button');
        tile.setAttribute('aria-label', 'Topic card ' + n);
        tile.innerHTML =
            '<div class="tile-curtain tile-curtain-l"></div>' +
            '<div class="tile-curtain tile-curtain-r"></div>' +
            '<div class="tile-seal">' + n + '</div>' +
            '<div class="tile-question" id="tileq-' + n + '"></div>' +
            '<div class="tile-num-tag">' + n + '</div>' +
            '<div class="tile-chip" id="chip-' + n + '"></div>' +
            '<div class="tile-time" id="time-' + n + '"></div>' +
            '<div class="tile-shine"></div>';
        tile.addEventListener('click', () => handleTileClick(n));
        board.appendChild(tile);
        newTiles.push(tile);
    }

    cardsRenderedCount = batchEnd;
    updateBoardLayout();
    animateBatchEntry(newTiles);
}

function updateBoardLayout() {
    const count = Math.max(1, cardsRenderedCount);
    const cols = window.innerWidth < 1150 ? Math.min(count, 3) : (count > 8 ? 5 : Math.min(count, 4));
    const rows = Math.max(1, Math.ceil(count / cols));
    board.style.setProperty('--cols', cols);
    board.style.setProperty('--rows', rows);
    // Opened tiles tighten their type and line budget as the rows get shorter
    board.dataset.density = rows >= 4 ? 'dense' : (rows === 3 ? 'mid' : 'roomy');
}

/* ---------------- Tile animations: entry cascade, 3D hover, shine ---------------- */

function animateBatchEntry(tiles) {
    if (!tiles.length) return;
    if (reducedMotion) {
        tiles.forEach(attachTileFX);
        return;
    }
    gsap.from(tiles, {
        y: () => -window.innerHeight * (0.6 + Math.random() * 0.5),
        opacity: 0,
        rotationX: -55,
        duration: 0.9,
        ease: 'back.out(1.2)',
        stagger: { each: 0.06, from: 'random' },
        onComplete() {
            gsap.set(tiles, { clearProps: 'transform,opacity' });
            tiles.forEach(attachTileFX);
        }
    });
}

function attachTileFX(tile) {
    if (reducedMotion) return;
    const shine = tile.querySelector('.tile-shine');
    const toRotX = gsap.quickTo(tile, 'rotationX', { duration: 0.4, ease: 'power2.out' });
    const toRotY = gsap.quickTo(tile, 'rotationY', { duration: 0.4, ease: 'power2.out' });

    tile.addEventListener('mousemove', e => {
        if (stageActive || stageBusy) return;
        const r = tile.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        toRotY(px * 10);
        toRotX(-py * 10);
    });

    tile.addEventListener('mouseenter', () => {
        if (stageActive || stageBusy) return;
        gsap.to(tile, { scale: 1.045, duration: 0.35, ease: 'power2.out' });
        gsap.killTweensOf(shine);
        gsap.fromTo(shine,
            { xPercent: -180, rotation: 10, opacity: 0.7 },
            {
                xPercent: 260, rotation: 10, duration: 1.15, ease: 'sine.inOut',
                onComplete: () => gsap.set(shine, { opacity: 0 })
            });
    });

    tile.addEventListener('mouseleave', () => {
        toRotX(0);
        toRotY(0);
        gsap.to(tile, { scale: 1, duration: 0.4, ease: 'power2.out' });
    });
}

/* ---------------- Speaker flow ---------------- */

function handleTileClick(n) {
    if (stageActive || stageBusy) return;
    const existing = selectionHistory.find(item => item.cardNumber === n);
    if (existing) {
        openStage(n, existing.speaker);
        return;
    }
    if (!armedSpeaker) {
        lockedTileFeedback(n);
        return;
    }
    const name = armedSpeaker;
    armedSpeaker = null;
    updateBoardLock();

    const chip = $('chip-' + n);
    chip.textContent = name;
    chip.classList.toggle('is-long', name.length > 12 && name.length <= 22);
    chip.classList.toggle('is-xlong', name.length > 22);
    const tileText = stripQuestionNumber(allTopics[n - 1].text);
    $('tileq-' + n).textContent = tileText;
    $('tileq-' + n).classList.toggle('is-long', tileText.length > 110);
    $('tile-' + n).classList.add('is-assigned');
    selectionHistory.push({
        speaker: name,
        cardNumber: n,
        question: allTopics[n - 1].text
    });
    openStage(n, name, true);
}

function promptSpeakerName() {
    bigSpeakerInput.value = '';
    openModal(nameModal);
    setTimeout(() => bigSpeakerInput.focus(), 60);
}

function submitSpeakerName() {
    const name = bigSpeakerInput.value.trim();
    if (!name) {
        alert('Please enter a valid speaker name to continue.');
        return;
    }
    closeNameModal();
    armedSpeaker = name;
    setCurrentSpeaker(name);
    updateBoardLock();
}

function closeNameModal() {
    closeModal(nameModal);
}

function updateBoardLock() {
    board.classList.toggle('speaker-locked', !armedSpeaker);
}

function lockedTileFeedback(n) {
    if (reducedMotion) return;
    gsap.fromTo($('tile-' + n), { x: -7 }, {
        x: 7, duration: 0.07, repeat: 5, yoyo: true,
        ease: 'power1.inOut', clearProps: 'x'
    });
    gsap.fromTo(nextSpeakerBtn, { scale: 1 }, {
        scale: 1.15, duration: 0.18, repeat: 3, yoyo: true,
        ease: 'power1.inOut', clearProps: 'transform'
    });
}

function setCurrentSpeaker(name) {
    currentSpeakerName = name;
    currentSpeakerNameEl.textContent = name;
    currentSpeakerNameEl.classList.toggle("is-long", name.length > 16);
    if (!reducedMotion) {
        gsap.fromTo(currentSpeakerNameEl,
            { scale: 0.7, opacity: 0 },
            { scale: 1, opacity: 1, duration: 0.5, ease: 'back.out(2)', clearProps: 'all' });
    }
}

/* ---------------- Stage: flight, depth of field, curtain, text reveal ---------------- */

function buildStageContent(n, speaker) {
    const topic = allTopics[n - 1];
    const questionText = stripQuestionNumber(topic.text);
    stageKeyword.textContent = '';   // sets carry questions only — the title line stays hidden
    stageSpeaker.textContent = speaker || '';
    stageSealL.textContent = n;
    stageSealR.textContent = n;
    stageQuestion.classList.toggle('is-long', questionText.length > 110);
    stageQuestion.innerHTML = questionText
        .split(/\s+/)
        .map(w => '<span class="word">' + escapeHTML(w) + ' </span>')
        .join('');
    return stageQuestion.querySelectorAll('.word');
}

function openStage(n, speaker, isFresh) {
    if (stageActive || stageBusy) return;
    stageActive = true;
    stageBusy = true;

    originTile = $('tile-' + n);
    const words = buildStageContent(n, speaker);
    const rect = originTile.getBoundingClientRect();

    const targetW = window.innerWidth;
    const targetH = window.innerHeight;
    const targetX = 0;
    const targetY = 0;

    stageVeil.classList.add('active');
    $('stage').classList.add('active');
    gsap.set(stageVeil, {
        backgroundColor: 'rgba(0,0,0,0)',
        backdropFilter: 'blur(0px)',
        webkitBackdropFilter: 'blur(0px)'
    });
    gsap.set(stageCard, {
        left: rect.left, top: rect.top,
        width: rect.width, height: rect.height,
        borderRadius: 14, autoAlpha: 1
    });
    // Already-answered cards skip the curtain ceremony — they simply enlarge
    const isRevealed = !isFresh;
    if (isRevealed) {
        gsap.set(curtainLeft, { xPercent: -103, skewX: 0 });
        gsap.set(curtainRight, { xPercent: 103, skewX: 0 });
        gsap.set([stageSealL, stageSealR], { autoAlpha: 0 });
    } else {
        gsap.set([curtainLeft, curtainRight], { xPercent: 0, skewX: 0, transformOrigin: 'center bottom' });
        const sealScale = Math.max(0.05, rect.height / targetH);
        gsap.set([stageSealL, stageSealR], {
            xPercent: -50, yPercent: -50, x: 0, y: 0, rotation: 0, scale: sealScale, autoAlpha: 1
        });
    }
    gsap.set('#stageHead > *', { clearProps: 'all' });
    gsap.set(['#stageTimeline', '#stageQuestion', '#stageKeyword'], { clearProps: 'opacity,transform' });
    stageCardNumber = n;
    const record = selectionHistory.find(i => i.cardNumber === n);
    resetStageTimer(record && record.speechSeconds != null ? record.speechSeconds : null);
    // Name and question sit on stage from the start — the curtain alone reveals them.
    // Fresh opens hold the bottom deck back for a quiet beat; reopens show everything at once.
    // (Must come after resetStageTimer, which makes the action button visible.)
    if (isRevealed) {
        gsap.set(['.stage-actions > *', '#stageTimeline'], { clearProps: 'opacity,visibility,transform' });
        gsap.set(stageCloseBtn, { autoAlpha: 1 });
    } else {
        gsap.set(['.stage-actions > *', '#stageTimeline'], { autoAlpha: 0, y: 14 });
        gsap.set(stageCloseBtn, { autoAlpha: 0 });
    }
    originTile.style.visibility = 'hidden';

    const tl = gsap.timeline({ onComplete: () => { stageBusy = false; stageOpenTl = null; } });
    stageOpenTl = tl;
    tl.to(stageVeil, {
            backgroundColor: 'rgba(0,0,0,0.45)',
            backdropFilter: 'blur(14px)',
            webkitBackdropFilter: 'blur(14px)',
            duration: dur(0.7), ease: 'power2.out'
        }, 0)
        .to(stageCard, {
            left: targetX, top: targetY,
            width: targetW, height: targetH,
            borderRadius: 0,
            duration: dur(0.85), ease: 'power3.inOut'
        }, 0.05);

    if (!isRevealed) {
        tl.to([stageSealL, stageSealR], { scale: 1, duration: dur(0.85), ease: 'power3.inOut' }, 0.05)
            .add(() => startFireflies())
            // Gentle escalating tremor → sharp crack
            .to([stageSealL, stageSealR], {
                keyframes: { rotation: [0, -0.6, 0.8, -1.2, 1.7, -2.3, 2.8, -1.2, 0] },
                duration: dur(0.6), ease: 'power1.in'
            }, '+=0.05')
            .to(stageSealL, { x: -18, rotation: -6, duration: dur(0.09), ease: 'power4.out' })
            .to(stageSealR, { x: 18, rotation: 6, duration: dur(0.09), ease: 'power4.out' }, '<')
            .addLabel('crack', '<')
            // Broken halves obey gravity: a light outward toss, a beat of hang, then an accelerating drop
            .to(stageSealL, { x: -160, rotation: -50, duration: dur(1.1), ease: 'power2.out' }, 'crack+=0.09')
            .to(stageSealR, { x: 160, rotation: 50, duration: dur(1.1), ease: 'power2.out' }, '<')
            .to([stageSealL, stageSealR], {
                y: () => window.innerHeight * 0.8,
                duration: dur(0.95), ease: 'power2.in'
            }, '<+=0.1')
            // Silk sweep: a breath of inward tension, then a long velvet glide with fabric drag
            .to(curtainLeft, { xPercent: 1.4, duration: dur(0.24), ease: 'power2.out' }, 'crack+=0.21')
            .to(curtainRight, { xPercent: -1.4, duration: dur(0.24), ease: 'power2.out' }, '<')
            .to(curtainLeft, { xPercent: -103, duration: dur(1.7), ease: 'power4.inOut' }, 'crack+=0.45')
            .to(curtainRight, { xPercent: 103, duration: dur(1.7), ease: 'power4.inOut' }, '<')
            .to(curtainLeft, { keyframes: { skewX: [0, -4, 0] }, duration: dur(1.7), ease: 'none' }, '<')
            .to(curtainRight, { keyframes: { skewX: [0, 4, 0] }, duration: dur(1.7), ease: 'none' }, '<')
            // Two quiet seconds with just the question before the bottom deck arrives
            .to(['.stage-actions > *', '#stageTimeline'], { autoAlpha: 1, y: 0, duration: dur(0.5), ease: 'power2.out' }, '+=2')
            .to(stageCloseBtn, { autoAlpha: 1, duration: dur(0.25) }, '<');
    } else {
        tl.add(() => startFireflies());
    }
}

/* ------------------------------------------------------------------
   Stage timer — 4-state machine driven by one morphing button:
   ready-think → thinking → speaking → done (time captured)
   ------------------------------------------------------------------ */

const THINK_SECONDS = 30;
const SPEAK_SECONDS = 150;
const SPEAK_CAP = 600; // keep counting past the hard stop for honest records
const MILESTONES = [
    { at: 60, node: 'tlNode1', bar: '#3FA36B' },
    { at: 90, node: 'tlNode2', bar: '#F2DF74' },
    { at: 120, node: 'tlNode3', bar: '#D64545' }
];

let phaseTl = null;
let timerState = 'idle';
let stageCardNumber = null;
let finishCloseCall = null;
const thinkProxy = { t: 0 };
const speechProxy = { t: 0 };

/* Pure hue stops for the blend-mode wash — the base stays dark, the hue is
   swapped wholesale, so green is vivid green and red has zero blue bleed. */
const STAGE_WASH = {
    blue: '#002A42',
    green: '#17A15C',
    yellow: '#F2DF74',
    red: '#E5312B',
    danger: '#7A0E18'
};

/* Accent colors for the numeric timer, synced with the stage */
const DIGIT_COLORS = {
    white: '#FFFFFF',
    green: '#5BC489',
    yellow: '#F2DF74',
    red: '#F07070'
};

function speechBgFor(sec) {
    if (sec >= 120) return STAGE_WASH.red;
    if (sec >= 90) return STAGE_WASH.yellow;
    if (sec >= 60) return STAGE_WASH.green;
    return STAGE_WASH.blue;
}

function digitColorFor(sec) {
    if (sec >= 120) return DIGIT_COLORS.red;
    if (sec >= 90) return DIGIT_COLORS.yellow;
    if (sec >= 60) return DIGIT_COLORS.green;
    return DIGIT_COLORS.white;
}

/* CSS signal class for a recorded time (tile badges + leaderboard) */
function timeClass(sec) {
    if (sec > SPEAK_SECONDS) return 'time-max';
    if (sec >= 120) return 'time-red';
    if (sec >= 90) return 'time-yellow';
    if (sec >= 60) return 'time-green';
    return '';
}

const ACTION_STATES = {
    think: { text: 'Start Thinking', stop: false, icon: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' },
    speak: { text: 'Start Speech', stop: false, icon: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><polygon points="6 3 20 12 6 21 6 3"/></svg>' },
    finish: { text: 'Finish', stop: true, icon: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>' }
};

function fmtClock(s) {
    s = Math.max(0, Math.floor(s));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

function fmtShort(s) {
    s = Math.max(0, Math.round(s));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function setActionBtn(key) {
    const s = ACTION_STATES[key];
    startSpeechBtn.innerHTML = s.icon + '<span>' + s.text + '</span>';
    startSpeechBtn.classList.toggle('is-stop', s.stop);
}

function morphActionBtn(key) {
    gsap.killTweensOf(startSpeechBtn);
    gsap.to(startSpeechBtn, {
        scale: 0.88, opacity: 0, duration: dur(0.16), ease: 'power2.in',
        onComplete() {
            setActionBtn(key);
            gsap.to(startSpeechBtn, { scale: 1, opacity: 1, duration: dur(0.3), ease: 'back.out(1.8)' });
        }
    });
}

function speechColorFor(sec) {
    if (sec >= 120) return '#D64545';
    if (sec >= 90) return '#F2DF74';
    if (sec >= 60) return '#3FA36B';
    return 'rgba(255, 255, 255, 0.9)';
}

function resetStageTimer(recordedSeconds) {
    if (phaseTl) { phaseTl.kill(); phaseTl = null; }
    thinkProxy.t = 0;
    speechProxy.t = 0;
    gsap.killTweensOf([tlFill, tlHead, stageWash, stageMaxTime, startSpeechBtn, stageCounter, stageCounterDigits]);
    gsap.killTweensOf('.tl-card');
    gsap.killTweensOf('.tl-node');
    gsap.set('.tl-card', { xPercent: -50, autoAlpha: 0, y: 12, scale: 0.85 });
    gsap.set(tlHead, { clearProps: 'boxShadow' });
    gsap.set(stageMaxTime, { autoAlpha: 0 });
    gsap.set(stageCounterDigits, { clearProps: 'color,opacity' });

    if (recordedSeconds != null) {
        // Re-opened, already-answered card: show the captured record
        timerState = 'done';
        startSpeechBtn.style.display = 'none';
        stageCounterLabel.textContent = 'Recorded Time';
        stageCounterDigits.textContent = fmtShort(recordedSeconds);
        gsap.set(stageCounter, { autoAlpha: 1, y: 0 });
        gsap.set(stageWash, { backgroundColor: speechBgFor(recordedSeconds) });
        gsap.set(stageCounterDigits, { color: digitColorFor(recordedSeconds) });
        const frac = Math.min(recordedSeconds / SPEAK_SECONDS, 1);
        gsap.set(tlFill, { scaleX: frac, backgroundColor: speechColorFor(recordedSeconds) });
        gsap.set(tlHead, { left: (frac * 100) + '%' });
        gsap.set('.tl-node', { autoAlpha: 0.55 });
    } else {
        // State 1 — Initial Reveal
        timerState = 'ready-think';
        startSpeechBtn.style.display = '';
        gsap.set(startSpeechBtn, { autoAlpha: 1, scale: 1, y: 0 });
        setActionBtn('think');
        stageCounterLabel.textContent = 'Time to Think';
        stageCounterDigits.textContent = '00:00 / 00:30';
        gsap.set(stageCounter, { autoAlpha: 1, y: 0 });
        gsap.set(stageWash, { backgroundColor: STAGE_WASH.blue });
        gsap.set(tlFill, { scaleX: 0, backgroundColor: 'rgba(169, 178, 177, 0.85)' });
        gsap.set(tlHead, { left: '0%' });
        gsap.set('.tl-node', { autoAlpha: 0 });
    }
}

function handleStageAction() {
    if (timerState === 'ready-think') startThinking();
    else if (timerState === 'thinking') startSpeaking();
    else if (timerState === 'speaking') stopSpeech();
}

/* State 2 — the digital counter climbs toward 00:30 while a subtle
   cool-gray progress bar tracks the thinking time on the timeline */
function startThinking() {
    timerState = 'thinking';
    morphActionBtn('speak');
    thinkProxy.t = 0;
    phaseTl = gsap.timeline();
    phaseTl.to(tlFill, { scaleX: 1, duration: THINK_SECONDS, ease: 'none' }, 0)
        .to(tlHead, { left: '100%', duration: THINK_SECONDS, ease: 'none' }, 0)
        .to(thinkProxy, {
        t: THINK_SECONDS, duration: THINK_SECONDS, ease: 'none',
        onUpdate() {
            stageCounterDigits.textContent = fmtClock(thinkProxy.t) + ' / ' + fmtClock(THINK_SECONDS);
        }
    }, 0).call(() => {
        // Thinking time is up — nudge the speaker toward Start Speech
        if (!reducedMotion) {
            gsap.fromTo(startSpeechBtn, { scale: 1 },
                { scale: 1.07, duration: 0.32, repeat: 5, yoyo: true, ease: 'sine.inOut' });
        }
    });
}

function hitMilestone(m) {
    const card = document.querySelector('#' + m.node + ' .tl-card');
    gsap.fromTo(card,
        { autoAlpha: 0, y: 12, scale: 0.85, xPercent: -50 },
        { autoAlpha: 1, y: 0, scale: 1, xPercent: -50, duration: dur(0.55), ease: 'back.out(2)' });
    gsap.to(tlFill, { backgroundColor: m.bar, duration: 1, ease: 'sine.inOut' });
}

/* 2:30 hard stop: lock the dangerous state, elegant overlay, urgent pulses */
function hardStop() {
    const endCard = document.querySelector('#tlNodeEnd .tl-card');
    gsap.fromTo(endCard,
        { autoAlpha: 0, y: 12, scale: 0.85, xPercent: -50 },
        { autoAlpha: 1, y: 0, scale: 1, xPercent: -50, duration: dur(0.5), ease: 'back.out(2)' });
    gsap.fromTo(stageMaxTime,
        { autoAlpha: 0, scale: 0.92, y: 12 },
        { autoAlpha: 1, scale: 1, y: 0, duration: dur(0.7), ease: 'power2.out' });
    gsap.to(tlHead, { boxShadow: '0 0 14px rgba(229, 49, 43, 0.9), 0 0 32px rgba(229, 49, 43, 0.5)', duration: 0.6 });
    if (!reducedMotion) {
        // Dangerous state: the wash and the digits breathe in dark crimson
        gsap.to(stageWash, {
            backgroundColor: STAGE_WASH.red, duration: 1.1,
            repeat: -1, yoyo: true, ease: 'sine.inOut'
        });
        gsap.to(stageCounterDigits, {
            opacity: 0.5, duration: 0.55,
            repeat: -1, yoyo: true, ease: 'sine.inOut'
        });
    }
}

/* State 3 — the timer keeps counting on screen while the background
   morphs continuously through the timing-signal hues (ease: none) */
function startSpeaking() {
    timerState = 'speaking';
    if (phaseTl) { phaseTl.kill(); phaseTl = null; }
    morphActionBtn('finish');
    stageCounterLabel.textContent = 'Time to Speak';
    stageCounterDigits.textContent = '00:00';
    gsap.set(tlFill, { scaleX: 0, backgroundColor: 'rgba(255, 255, 255, 0.9)' });
    gsap.set(tlHead, { left: '0%' });
    gsap.to('.tl-node', { autoAlpha: 1, duration: dur(0.4), stagger: dur(0.06) });

    speechProxy.t = 0;
    phaseTl = gsap.timeline();
    phaseTl.to(tlFill, { scaleX: 1, duration: SPEAK_SECONDS, ease: 'none' }, 0)
        .to(tlHead, { left: '100%', duration: SPEAK_SECONDS, ease: 'none' }, 0)
        .to(speechProxy, {
            t: SPEAK_CAP, duration: SPEAK_CAP, ease: 'none',
            onUpdate() { stageCounterDigits.textContent = fmtClock(speechProxy.t); }
        }, 0)
        // Precise pacing (linear): hold blue→0:45, full green @1:00, hold,
        // full Happy Yellow @1:30, hold, full red @2:00, hold, then the
        // dangerous crimson creeps in 2:15→2:30. Digits tint in sync.
        .to(stageWash, { backgroundColor: STAGE_WASH.green, duration: 15, ease: 'none' }, 45)
        .to(stageWash, { backgroundColor: STAGE_WASH.yellow, duration: 15, ease: 'none' }, 75)
        .to(stageWash, { backgroundColor: STAGE_WASH.red, duration: 15, ease: 'none' }, 105)
        .to(stageWash, { backgroundColor: STAGE_WASH.danger, duration: 15, ease: 'none' }, 135)
        .to(stageCounterDigits, { color: DIGIT_COLORS.green, duration: 15, ease: 'none' }, 45)
        .to(stageCounterDigits, { color: DIGIT_COLORS.yellow, duration: 15, ease: 'none' }, 75)
        .to(stageCounterDigits, { color: DIGIT_COLORS.red, duration: 15, ease: 'none' }, 105);
    MILESTONES.forEach(m => phaseTl.call(() => hitMilestone(m), null, m.at));
    phaseTl.call(hardStop, null, SPEAK_SECONDS);
}

/* State 5 — Finish: capture the record, quiet the stage */
function stopSpeech() {
    if (timerState !== 'speaking') return;
    timerState = 'done';
    const secs = Math.round(speechProxy.t);
    if (phaseTl) { phaseTl.kill(); phaseTl = null; }
    gsap.killTweensOf([startSpeechBtn, stageWash, stageCounterDigits]);
    gsap.set(stageWash, { backgroundColor: speechBgFor(secs) });
    gsap.set(stageCounterDigits, { color: digitColorFor(secs), opacity: 1 });

    const item = selectionHistory.find(i => i.cardNumber === stageCardNumber);
    if (item) item.speechSeconds = secs;
    const timeEl = $('time-' + stageCardNumber);
    if (timeEl) {
        timeEl.textContent = fmtShort(secs) + (secs > SPEAK_SECONDS ? ' • MAX' : '');
        timeEl.className = ('tile-time ' + timeClass(secs)).trim();
    }

    gsap.to(startSpeechBtn, {
        autoAlpha: 0, scale: 0.85, y: 8, duration: dur(0.4), ease: 'power2.in',
        onComplete() { startSpeechBtn.style.display = 'none'; }
    });
    gsap.to(stageMaxTime, { autoAlpha: 0, duration: dur(0.4), ease: 'power2.in' });
    stageCounterLabel.textContent = 'Recorded Time';
    stageCounterDigits.textContent = fmtShort(secs);
    if (!reducedMotion) {
        gsap.fromTo(stageCounter, { scale: 0.94 },
            { scale: 1, duration: dur(0.5), ease: 'back.out(2)', clearProps: 'transform' });
    }
    // Give the record a beat to land, then fly the card home on its own
    finishCloseCall = gsap.delayedCall(1.5, closeStage);
}

function closeStage() {
    if (!stageActive) return;
    if (stageBusy) {
        // Interrupt a still-running open animation; ignore if already closing
        if (stageOpenTl && stageOpenTl.isActive()) {
            stageOpenTl.kill();
            stageOpenTl = null;
        } else {
            return;
        }
    }
    stageBusy = true;
    stopFireflies();
    if (phaseTl) { phaseTl.kill(); phaseTl = null; }
    if (finishCloseCall) { finishCloseCall.kill(); finishCloseCall = null; }
    gsap.killTweensOf([stageWash, stageCounterDigits]);

    const rect = originTile.getBoundingClientRect();
    const tl = gsap.timeline({
        onComplete() {
            stageActive = false;
            stageBusy = false;
            stageVeil.classList.remove('active');
            $('stage').classList.remove('active');
            gsap.set(stageCard, { autoAlpha: 0 });
            gsap.set(stageContent, { clearProps: 'opacity' });
            originTile.style.visibility = '';
        }
    });
    tl.to(stageCloseBtn, { autoAlpha: 0, duration: dur(0.15) }, 0)
        .to(stageContent, { opacity: 0, duration: dur(0.3), ease: 'power1.out' }, 0)
        .to(stageMaxTime, { autoAlpha: 0, duration: dur(0.2) }, 0)
        .to(stageWash, { backgroundColor: STAGE_WASH.blue, duration: dur(0.5), ease: 'power1.inOut' }, 0)
        .to(stageCard, {
            left: rect.left, top: rect.top,
            width: rect.width, height: rect.height,
            borderRadius: 14,
            duration: dur(0.7), ease: 'power3.inOut'
        }, 0.05)
        .to(stageVeil, {
            backgroundColor: 'rgba(0,0,0,0)',
            backdropFilter: 'blur(0px)',
            webkitBackdropFilter: 'blur(0px)',
            duration: dur(0.55), ease: 'power2.inOut'
        }, '-=0.5');
}

/* ---------------- Firefly particles (Happy Yellow) ---------------- */

let ffParticles = [];
let ffRaf = null;

function makeFirefly(seedAnywhere) {
    return {
        x: Math.random() * ffCanvas.width,
        y: seedAnywhere ? Math.random() * ffCanvas.height : ffCanvas.height + 12,
        r: Math.random() * 2.6 + 1.6,
        vy: -(Math.random() * 0.4 + 0.15),
        sway: Math.random() * 10 + 4,
        phase: Math.random() * Math.PI * 2,
        speed: Math.random() * 0.02 + 0.008,
        alpha: Math.random() * 0.5 + 0.35
    };
}

function startFireflies() {
    if (reducedMotion) return;
    stopFireflies();
    ffCanvas.width = window.innerWidth;
    ffCanvas.height = window.innerHeight;
    ffParticles = [];
    for (let i = 0; i < 38; i++) ffParticles.push(makeFirefly(true));
    fireflyLoop();
}

function fireflyLoop() {
    ffCtx.clearRect(0, 0, ffCanvas.width, ffCanvas.height);
    ffCtx.shadowColor = '#F2DF74';
    ffCtx.shadowBlur = 12;
    for (let i = 0; i < ffParticles.length; i++) {
        const p = ffParticles[i];
        p.phase += p.speed;
        p.y += p.vy;
        if (p.y < -14) ffParticles[i] = makeFirefly(false);
        const x = p.x + Math.sin(p.phase * 3) * p.sway;
        const twinkle = 0.55 + 0.45 * Math.sin(p.phase * 5);
        ffCtx.beginPath();
        ffCtx.arc(x, p.y, p.r, 0, Math.PI * 2);
        ffCtx.fillStyle = 'rgba(242, 223, 116, ' + (p.alpha * twinkle).toFixed(3) + ')';
        ffCtx.fill();
    }
    ffCtx.shadowBlur = 0;
    ffRaf = requestAnimationFrame(fireflyLoop);
}

function stopFireflies() {
    if (ffRaf) cancelAnimationFrame(ffRaf);
    ffRaf = null;
    ffParticles = [];
    ffCtx.clearRect(0, 0, ffCanvas.width, ffCanvas.height);
}

/* ---------------- Voting list ---------------- */

/* A name is never truncated: it may wrap, and if a wrapped name is taller than
   its row the font steps down until the whole name fits. */
function fitVotingNames() {
    orderList.querySelectorAll('li').forEach(li => {
        const nameEl = li.querySelector('.row-name');
        if (!nameEl) return;
        nameEl.style.fontSize = '';
        let size = parseFloat(getComputedStyle(nameEl).fontSize);
        const floor = size * 0.45;
        while (li.querySelector('.row-id').scrollHeight > li.clientHeight - 4 && size > floor) {
            size -= 1;
            nameEl.style.fontSize = size + 'px';
        }
    });
}

function revealSelectionOrder() {
    orderList.innerHTML = '';
    if (selectionHistory.length === 0) {
        orderList.innerHTML = '<li><span class="empty-note">No speakers have been recorded yet!</span></li>';
    } else {
        const fragment = document.createDocumentFragment();
        selectionHistory.forEach((item, i) => {
            const li = document.createElement('li');
            const hasTime = item.speechSeconds != null;
            const cls = hasTime ? (' ' + timeClass(item.speechSeconds)).trimEnd() : ' no-time';
            const overMax = hasTime && item.speechSeconds > SPEAK_SECONDS;
            li.innerHTML =
                '<span class="row-main"><strong class="seq-num">' + (i + 1) + '</strong>' +
                '<span class="row-id">' +
                '<span class="row-name">' + escapeHTML(item.speaker) + '</span>' +
                '<span class="row-title">' + escapeHTML(stripQuestionNumber(item.question)) + '</span>' +
                '</span></span>' +
                '<span class="time-tag' + cls + '">' +
                (hasTime ? fmtClock(item.speechSeconds) : '—') +
                (overMax ? '<span class="max-flag">MAX</span>' : '') + '</span>';
            fragment.appendChild(li);
        });
        orderList.appendChild(fragment);
    }

    // One screen, no scrolling: up to 10 rows per column, a second column from 11 speakers
    const count = Math.max(1, selectionHistory.length);
    const cols = count > 10 ? 2 : 1;
    orderList.style.setProperty('--list-cols', cols);
    orderList.style.setProperty('--list-rows', Math.ceil(count / cols));
    orderList.dataset.cols = cols;
    listModal.querySelector('.list-panel').classList.toggle('is-two-col', cols === 2);

    openModal(listModal);
    fitVotingNames();
    if (!reducedMotion && orderList.children.length) {
        gsap.from(orderList.children, {
            x: -26, opacity: 0, duration: 0.45,
            stagger: 0.05, ease: 'power2.out', delay: 0.15, clearProps: 'all'
        });
    }
}

/* ---------------- Winner ceremony ---------------- */

function openWinnerModal() {
    winnerModalContainer.className = 'modal-panel panel-glass winner-panel state-prompt';
    winnerInput.value = '';
    actualWinnerName = '';
    openModal(winnerModal);
    setTimeout(() => winnerInput.focus(), 60);
}

function goToWinnerRevealScreen() {
    if (!actualWinnerName) {
        alert("Please type the winner's name first!");
        return;
    }
    $('certWinnerLabel').innerText = actualWinnerName;
    $('certDateLabel').innerText = formatToday();
    winnerModalContainer.className = 'modal-panel panel-glass winner-panel state-reveal';
}

function triggerWinnerCelebration() {
    winnerModalContainer.className = 'modal-panel panel-glass winner-panel state-celebration';
    document.body.classList.add('no-scroll');
    fitCertificate(winnerCertScaler, winnerCertFit, 0.92, 0.84, 1.6);
    startWinnerFx();
}

/* Celebration intensity: 1 = overwhelming opening barrage, decays to a calm
   drizzle over ~14 s. The fireworks launcher reads this value. */
const celebIntensity = { v: 0 };

/* ---------------- Winner fireworks (full-screen canvas) ---------------- */

let wfxParticles = [];
let wfxRaf = null;

function wfxExplosion(x, y, scale) {
    const total = Math.round(110 * scale);
    const color = FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)];
    for (let i = 0; i < total; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 11 + 3.5;
        wfxParticles.push({
            x, y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            alpha: 1,
            fadeRate: Math.random() * 0.010 + 0.007,
            color
        });
    }
}

function startWinnerFx() {
    stopWinnerFx();
    celebIntensity.v = 1;
    gsap.killTweensOf(celebIntensity);
    gsap.to(celebIntensity, { v: 0.05, duration: 14, ease: 'power2.out' });
    if (reducedMotion) return;
    wfxCanvas.width = window.innerWidth;
    wfxCanvas.height = window.innerHeight;
    // Opening barrage — a massive, screen-filling salvo
    for (let i = 0; i < 12; i++) {
        wfxExplosion(
            Math.random() * wfxCanvas.width,
            Math.random() * wfxCanvas.height * 0.7 + wfxCanvas.height * 0.06,
            1.6
        );
    }
    wfxLoop();
}

function wfxLoop() {
    wfxCtx.clearRect(0, 0, wfxCanvas.width, wfxCanvas.height);
    // Quadratic falloff: overwhelming at v=1, a rare gentle pop near v=0
    if (Math.random() < 0.30 * celebIntensity.v * celebIntensity.v + 0.004) {
        wfxExplosion(
            Math.random() * wfxCanvas.width,
            Math.random() * wfxCanvas.height * 0.55 + wfxCanvas.height * 0.08,
            0.35 + celebIntensity.v * 0.95
        );
    }
    for (let i = wfxParticles.length - 1; i >= 0; i--) {
        const p = wfxParticles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.05;
        p.vx *= 0.98;
        p.vy *= 0.98;
        p.alpha -= p.fadeRate;
        if (p.alpha <= 0) {
            wfxParticles.splice(i, 1);
            continue;
        }
        wfxCtx.beginPath();
        wfxCtx.arc(p.x, p.y, Math.random() * 3 + 2.6, 0, Math.PI * 2);
        wfxCtx.fillStyle = p.color;
        wfxCtx.globalAlpha = p.alpha;
        wfxCtx.fill();
    }
    wfxCtx.globalAlpha = 1;
    wfxRaf = requestAnimationFrame(wfxLoop);
}

function stopWinnerFx() {
    if (wfxRaf) cancelAnimationFrame(wfxRaf);
    wfxRaf = null;
    wfxParticles = [];
    gsap.killTweensOf(celebIntensity);
    celebIntensity.v = 0;
    wfxCtx.clearRect(0, 0, wfxCanvas.width, wfxCanvas.height);
}

function closeWinnerModal() {
    stopWinnerFx();
    document.body.classList.remove('no-scroll');
    closeModal(winnerModal);
}

/* ---------------- Certificate generator ---------------- */

function openGeneratorModal() {
    if (certificateData.length === 0) {
        $('certCsvInput').click();
    } else {
        updateCertificateView(false);
        openModal(generatorModal);
        fitCertificate(genCertScaler, genCertFit, 0.92, 0.76, 1.6);
    }
}

function handleCertCsvFile(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => parseCertificateCsv(e.target.result);
    reader.readAsText(file);
    input.value = '';
}

function parseCertificateCsv(text) {
    certificateData = [];
    const lines = text.split(/\r?\n/);

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const parts = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
        if (parts.length >= 3) {
            const level = parts[0].replace(/^"|"$/g, '').trim();
            const pathway = parts[1].replace(/^"|"$/g, '').trim();
            const name = parts[2].replace(/^"|"$/g, '').trim();
            if (level && pathway && name) {
                certificateData.push({ level, pathway, name });
            }
        }
    }

    if (certificateData.length === 0) {
        alert('Error parsing certificate.csv. Make sure the file has column data for headings starting on Row 2.');
        return;
    }

    certExportDate = formatToday();
    $('genDateLabel').innerText = certExportDate;

    currentCertIndex = 0;
    updateCertificateView(false);
    openModal(generatorModal);
    fitCertificate(genCertScaler, genCertFit, 0.92, 0.76, 1.6);
}

function updateCertificateView(skipFireworksAnimation) {
    if (certificateData.length === 0) return;

    const record = certificateData[currentCertIndex];
    $('genMainTitle').innerText = record.level;
    $('genSubTitle').innerText = record.pathway;

    const nameElement = $('certName');
    nameElement.innerText = record.name;
    adjustCertNameFont(nameElement);

    $('certCounter').innerText = 'Record: ' + (currentCertIndex + 1) + ' / ' + certificateData.length;
    $('prevCertBtn').disabled = (currentCertIndex === 0);
    $('nextCertBtn').disabled = (currentCertIndex === certificateData.length - 1);

    if (!skipFireworksAnimation) startFireworks();
}

function adjustCertNameFont(element) {
    let currentSize = 4.0;
    element.style.fontSize = currentSize + 'rem';
    while (element.scrollWidth > element.clientWidth && currentSize > 1.5) {
        currentSize -= 0.1;
        element.style.fontSize = currentSize + 'rem';
    }
}

function showNextCert() {
    if (currentCertIndex < certificateData.length - 1) {
        currentCertIndex++;
        updateCertificateView(false);
    }
}

function showPrevCert() {
    if (currentCertIndex > 0) {
        currentCertIndex--;
        updateCertificateView(false);
    }
}

/* ---------------- Fireworks (generator celebration) ---------------- */

let fwParticles = [];
let fwAnimationId = null;
let fwTimeoutId = null;

function startFireworks() {
    if (reducedMotion) return;
    stopFireworks();
    fwCanvas.width = window.innerWidth;
    fwCanvas.height = window.innerHeight;
    runFireworksLoop();
    fwTimeoutId = setTimeout(stopFireworks, 30000);
}

function createFireworkExplosion(x, y) {
    const totalParticles = 48;
    const assignedColor = FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)];
    for (let i = 0; i < totalParticles; i++) {
        const vectorAngle = Math.random() * Math.PI * 2;
        const blastVelocity = Math.random() * 6 + 2;
        fwParticles.push({
            x, y,
            vx: Math.cos(vectorAngle) * blastVelocity,
            vy: Math.sin(vectorAngle) * blastVelocity,
            alpha: 1,
            fadeRate: Math.random() * 0.012 + 0.012,
            color: assignedColor
        });
    }
}

function runFireworksLoop() {
    fwCtx.clearRect(0, 0, fwCanvas.width, fwCanvas.height);

    // Sparse celebration — a firework only every couple of seconds
    if (Math.random() < 0.012) {
        const targetX = Math.random() * fwCanvas.width;
        const targetY = Math.random() * (fwCanvas.height * 0.55) + (fwCanvas.height * 0.1);
        createFireworkExplosion(targetX, targetY);
    }

    for (let i = fwParticles.length - 1; i >= 0; i--) {
        const p = fwParticles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.05;
        p.vx *= 0.98;
        p.vy *= 0.98;
        p.alpha -= p.fadeRate;

        if (p.alpha <= 0) {
            fwParticles.splice(i, 1);
            continue;
        }
        fwCtx.beginPath();
        fwCtx.arc(p.x, p.y, Math.random() * 2.5 + 2.5, 0, Math.PI * 2);
        fwCtx.fillStyle = p.color;
        fwCtx.globalAlpha = p.alpha;
        fwCtx.fill();
    }

    fwCtx.globalAlpha = 1.0;
    fwAnimationId = requestAnimationFrame(runFireworksLoop);
}

function stopFireworks() {
    if (fwAnimationId) cancelAnimationFrame(fwAnimationId);
    if (fwTimeoutId) clearTimeout(fwTimeoutId);
    fwParticles = [];
    fwAnimationId = null;
    fwTimeoutId = null;
    fwCtx.clearRect(0, 0, fwCanvas.width, fwCanvas.height);
}

/* ---------------- Certificate display scaling ---------------- */

function fitCertificate(scalerEl, fitEl, wFrac, hFrac, maxScale) {
    const scale = Math.min(
        maxScale || 1,
        (window.innerWidth * (wFrac || 0.86)) / 1264,
        (window.innerHeight * (hFrac || 0.62)) / 744
    );
    scalerEl.style.transform = 'scale(' + scale + ')';
    fitEl.style.width = (1264 * scale) + 'px';
    fitEl.style.height = (744 * scale) + 'px';
}

function refitCertificates() {
    if (winnerModal.classList.contains('show')) fitCertificate(winnerCertScaler, winnerCertFit, 0.92, 0.84, 1.6);
    if (generatorModal.classList.contains('show')) fitCertificate(genCertScaler, genCertFit, 0.92, 0.76, 1.6);
}

/* ---------------- Wiring ---------------- */

function openDrawer() {
    settingsDrawer.classList.add('open');
    drawerVeil.classList.add('open');
    $('settingsBtn').setAttribute('aria-expanded', 'true');
}

function closeDrawer() {
    settingsDrawer.classList.remove('open');
    drawerVeil.classList.remove('open');
    $('settingsBtn').setAttribute('aria-expanded', 'false');
}

function init() {
    nextSpeakerBtn.addEventListener('click', promptSpeakerName);
    $('settingsBtn').addEventListener('click', openDrawer);
    $('drawerCloseBtn').addEventListener('click', closeDrawer);
    drawerVeil.addEventListener('click', closeDrawer);
    settingsDrawer.addEventListener('click', e => {
        if (e.target.closest('.drawer-item')) closeDrawer();
    });
    $('votingBtn').addEventListener('click', revealSelectionOrder);
    $('resultBtn').addEventListener('click', openWinnerModal);
    $('certificateBtn').addEventListener('click', openGeneratorModal);
    $('resetBtn').addEventListener('click', clearAndInitBoard);
    initAdminPanel();
    $('certCsvInput').addEventListener('change', e => handleCertCsvFile(e.target));

    $('nameCloseBtn').addEventListener('click', closeNameModal);
    $('nameSubmitBtn').addEventListener('click', submitSpeakerName);
    bigSpeakerInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') submitSpeakerName();
    });

    $('listCloseBtn').addEventListener('click', () => closeModal(listModal));
    listModal.addEventListener('click', e => {
        if (e.target === listModal) closeModal(listModal);
    });

    $('winnerCloseBtn').addEventListener('click', closeWinnerModal);
    $('winnerNextBtn').addEventListener('click', goToWinnerRevealScreen);
    $('revealChampionBtn').addEventListener('click', triggerWinnerCelebration);
    winnerInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') goToWinnerRevealScreen();
    });

    // Trophy masking: keeps the winner's name secret on screen while typing
    winnerInput.addEventListener('input', e => {
        const input = e.target;
        const val = input.value;
        let newChars = '';
        for (const char of val) {
            if (char !== '🏆') newChars += char;
        }
        if (val.length < actualWinnerName.length) {
            actualWinnerName = actualWinnerName.substring(0, val.length);
        } else if (newChars.length > 0) {
            actualWinnerName += newChars;
        }
        input.value = '🏆'.repeat(actualWinnerName.length);
    });

    $('generatorCloseBtn').addEventListener('click', () => {
        closeModal(generatorModal);
        stopFireworks();
    });
    generatorModal.addEventListener('click', e => {
        if (e.target === generatorModal) {
            closeModal(generatorModal);
            stopFireworks();
        }
    });
    $('prevCertBtn').addEventListener('click', showPrevCert);
    $('nextCertBtn').addEventListener('click', showNextCert);

    stageCloseBtn.addEventListener('click', closeStage);
    stageVeil.addEventListener('click', closeStage);
    startSpeechBtn.addEventListener('click', handleStageAction);

    document.addEventListener('keydown', e => {
        if (e.key !== 'Escape') return;
        if (settingsDrawer.classList.contains('open')) { closeDrawer(); return; }
        if (stageActive) { closeStage(); return; }
        if (nameModal.classList.contains('show')) { closeNameModal(); return; }
        if (listModal.classList.contains('show')) { closeModal(listModal); return; }
        if (winnerModal.classList.contains('show')) { closeWinnerModal(); return; }
        if (generatorModal.classList.contains('show')) {
            closeModal(generatorModal);
            stopFireworks();
        }
    });

    window.addEventListener('resize', () => {
        updateBoardLayout();
        refitCertificates();
        if (listModal.classList.contains("show")) fitVotingNames();
        if (generatorModal.classList.contains('show')) {
            fwCanvas.width = window.innerWidth;
            fwCanvas.height = window.innerHeight;
        }
        if (winnerModal.classList.contains('show')) {
            wfxCanvas.width = window.innerWidth;
            wfxCanvas.height = window.innerHeight;
        }
    });

    if (!reducedMotion) {
        gsap.from('.topbar', { y: -42, opacity: 0, duration: 0.7, ease: 'power2.out' });
    }

    loginForm.addEventListener('submit', e => {
        e.preventDefault();
        submitLogin();
    });
    startSession();
}

init();
