const els = {
    profileName: document.getElementById("profileName"),
    profileSelect: document.getElementById("profileSelect"),

    saveBtn: document.getElementById("saveBtn"),
    deleteBtn: document.getElementById("deleteBtn"),
    resetBtn: document.getElementById("resetBtn"),

    proxyPowerToggle: document.getElementById("proxyPowerToggle"),
    proxyPowerLabel: document.getElementById("proxyPowerLabel"),

    modeToggle: document.getElementById("modeToggle"),
    modeText: document.getElementById("modeText"),
    infoIcon: document.getElementById("infoIcon"),
    infoBox: document.getElementById("infoBox"),
    copyButton: document.getElementById("copyButton"),
    copyList: document.getElementById("copyList"),

    targets: document.getElementById("targets"),

    httpHost: document.getElementById("httpHost"),
    httpPort: document.getElementById("httpPort"),
    sslHost: document.getElementById("sslHost"),
    sslPort: document.getElementById("sslPort"),
    ftpHost: document.getElementById("ftpHost"),
    ftpPort: document.getElementById("ftpPort"),

    schemeRadios: document.querySelectorAll('input[name="scheme"]'),

    exportSettings: document.getElementById("exportSettings"),
    importSettings: document.getElementById("importSettings"),
    importFile: document.getElementById("importFile"),

    status: document.getElementById("status")
};

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = "12334";
const DEFAULT_SCHEME = "socks5";
const DEFAULT_PROFILE = "Default";
const DEFAULT_MODE = "proxy";

function getSelectedScheme() {
    for (const r of els.schemeRadios) if (r.checked) return r.value;
    return DEFAULT_SCHEME;
}

function setSelectedScheme(s) {
    let ok = false;
    els.schemeRadios.forEach(r => {
        if (r.value === s) {
            r.checked = true;
            ok = true;
        }
    });
    if (!ok) {
        els.schemeRadios.forEach(r => {
            if (r.value === DEFAULT_SCHEME) r.checked = true;
        });
    }
}

function showStatus(t) {
    els.status.textContent = t || "";
}

function markDirty() {
    els.saveBtn.classList.remove("save-green");
    els.saveBtn.classList.add("save-yellow");
}

function storageGet(keys) {
    return new Promise(r => chrome.storage.local.get(keys, r));
}

function storageSet(obj) {
    return new Promise(r => chrome.storage.local.set(obj, r));
}

function storageRemove(k) {
    return new Promise(r => chrome.storage.local.remove(k, r));
}

function parseTargets(text) {
    return text
    .split(/[\n,]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(cleanTarget)
    .filter(Boolean);
}

function cleanTarget(str) {
    try {
        if (str.includes("://")) return new URL(str).hostname;
            if (str.includes("/") || str.includes("?"))
                return new URL("http://" + str).hostname;
        return str;
    } catch (_) {
        return str.replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
    }
}

function setMode(m) {
    if (m === "proxy") {
        els.modeToggle.classList.remove("on");
        els.modeText.textContent = "Введённые адреса будут проксироваться";
    } else {
        els.modeToggle.classList.add("on");
        els.modeText.textContent = "Введённые адреса будут исключаться";
    }
}

function getMode() {
    return els.modeToggle.classList.contains("on") ? "bypass" : "proxy";
}

function fillDefaultForm() {
    els.targets.value = "";
    els.httpHost.value = DEFAULT_HOST;
    els.httpPort.value = DEFAULT_PORT;
    els.sslHost.value = DEFAULT_HOST;
    els.sslPort.value = DEFAULT_PORT;
    els.ftpHost.value = DEFAULT_HOST;
    els.ftpPort.value = DEFAULT_PORT;
    setSelectedScheme(DEFAULT_SCHEME);
    setMode(DEFAULT_MODE);
}

async function ensureDefaults() {
    const d = await storageGet(["profiles", "activeProfile", "proxyEnabled"]);
    let profiles = d.profiles || [];
    let active = d.activeProfile;

    if (!profiles.length) {
        profiles = [DEFAULT_PROFILE];

        const obj = {
            name: DEFAULT_PROFILE,
            targets: [],
            http: { host: DEFAULT_HOST, port: DEFAULT_PORT },
            ssl: { host: DEFAULT_HOST, port: DEFAULT_PORT },
            ftp: { host: DEFAULT_HOST, port: DEFAULT_PORT },
            scheme: DEFAULT_SCHEME,
            mode: DEFAULT_MODE
        };

        await storageSet({
            profiles,
            activeProfile: DEFAULT_PROFILE,
            proxyEnabled: false,
            ["profile:" + DEFAULT_PROFILE]: obj
        });

        return {
            profiles,
            activeProfile: DEFAULT_PROFILE,
            proxyEnabled: false
        };
    }

    if (!active || !profiles.includes(active)) {
        active = profiles[0];
        await storageSet({ activeProfile: active });
    }

    return {
        profiles,
        activeProfile: active,
        proxyEnabled: d.proxyEnabled ?? false
    };
}

async function loadProfilesIntoUI() {
    const d = await ensureDefaults();
    els.profileSelect.textContent = "";
    d.profiles.forEach(n => {
        const o = document.createElement("option");
        o.value = o.textContent = n;
        els.profileSelect.appendChild(o);
    });

    els.profileSelect.value = d.activeProfile;
    els.profileName.value = d.activeProfile;
    updatePowerToggle(d.proxyEnabled);

    await loadProfile(d.activeProfile);
}

async function loadProfile(name) {
    const d = await storageGet("profile:" + name);
    const pr = d["profile:" + name];

    if (!pr) {
        fillDefaultForm();
        els.saveBtn.classList.add("save-yellow");
        return;
    }

    els.targets.value = (pr.targets || []).join(", ");
    els.httpHost.value = pr.http?.host || DEFAULT_HOST;
    els.httpPort.value = pr.http?.port || DEFAULT_PORT;
    els.sslHost.value = pr.ssl?.host || DEFAULT_HOST;
    els.sslPort.value = pr.ssl?.port || DEFAULT_PORT;
    els.ftpHost.value = pr.ftp?.host || DEFAULT_HOST;
    els.ftpPort.value = pr.ftp?.port || DEFAULT_PORT;

    setSelectedScheme(pr.scheme || DEFAULT_SCHEME);
    setMode(pr.mode || DEFAULT_MODE);

    els.saveBtn.classList.add("save-green");
    els.saveBtn.classList.remove("save-yellow");
    showStatus("");
}

function buildFormProfile(name) {
    return {
        name,
        targets: parseTargets(els.targets.value),
        http: {
            host: els.httpHost.value.trim() || DEFAULT_HOST,
            port: els.httpPort.value.trim() || DEFAULT_PORT
        },
        ssl: {
            host: els.sslHost.value.trim() || DEFAULT_HOST,
            port: els.sslPort.value.trim() || DEFAULT_PORT
        },
        ftp: {
            host: els.ftpHost.value.trim() || DEFAULT_HOST,
            port: els.ftpPort.value.trim() || DEFAULT_PORT
        },
        scheme: getSelectedScheme(),
        mode: getMode()
    };
}

async function saveProfile() {
    const name = els.profileName.value.trim();
    if (!name) return showStatus("Введите имя профиля.");

    const pr = buildFormProfile(name);
    const d = await storageGet("profiles");
    let profiles = d.profiles || [];

    profiles.push(name);
    profiles = [...new Set(profiles)];

    const obj = { profiles, activeProfile: name };
    obj["profile:" + name] = pr;

    await storageSet(obj);
    await loadProfilesIntoUI();
    await applyCurrentProfile();

    els.saveBtn.classList.remove("save-yellow");
    els.saveBtn.classList.add("save-green");
    showStatus("Профиль сохранён.");
}

async function resetProfile() {
    const name = els.profileName.value.trim();
    if (!name) return;
    await loadProfile(name);
    els.saveBtn.classList.add("save-green");
    els.saveBtn.classList.remove("save-yellow");
    showStatus("Настройки восстановлены.");
}

async function deleteProfile() {
    const name = els.profileName.value.trim();
    const d = await storageGet(["profiles", "activeProfile"]);
    let profiles = d.profiles || [];

    profiles = profiles.filter(p => p !== name);
    const obj = { profiles };

    if (d.activeProfile === name) {
        obj.activeProfile = profiles[0] || null;
    }

    await storageRemove("profile:" + name);
    await storageSet(obj);

    if (profiles.length) {
        els.profileSelect.value = profiles[0];
        els.profileName.value = profiles[0];
        await loadProfile(profiles[0]);
        await applyCurrentProfile();
    } else {
        fillDefaultForm();
        els.profileSelect.textContent = "";
    }

    showStatus("Профиль удалён.");
}

async function profileChanged() {
    const name = els.profileSelect.value;
    els.profileName.value = name;
    await storageSet({ activeProfile: name });
    await loadProfile(name);
    await applyCurrentProfile();

    els.saveBtn.classList.add("save-green");
    els.saveBtn.classList.remove("save-yellow");
}

async function applyCurrentProfile() {
    const d = await storageGet(["activeProfile", "proxyEnabled"]);
    chrome.runtime.sendMessage({
        type: "applyProfile",
        name: d.activeProfile,
        enabled: d.proxyEnabled
    });
}

function toggleMode() {
    if (els.modeToggle.classList.contains("on")) {
        els.modeToggle.classList.remove("on");
        els.modeText.textContent = "Введённые адреса будут проксироваться";
    } else {
        els.modeToggle.classList.add("on");
        els.modeText.textContent = "Введённые адреса будут исключаться";
    }
    markDirty();
}

function toggleInfoBox() {
    els.infoBox.classList.toggle("show");
}

function copyText() {
    navigator.clipboard.writeText(els.copyList.textContent.trim());
    showStatus("Скопировано");
    setTimeout(() => showStatus(""), 1300);
}

async function toggleProxyPower() {
    const d = await storageGet("proxyEnabled");
    const cur = d.proxyEnabled ?? false;
    const st = !cur;

    await storageSet({ proxyEnabled: st });
    updatePowerToggle(st);

    chrome.runtime.sendMessage({
        type: "proxyPower",
        enabled: st
    });

    if (st) {
        applyCurrentProfile();
        showStatus("Прокси включён.");
    } else {
        showStatus("Прокси выключен.");
    }
}

function updatePowerToggle(on) {
    if (on) {
        els.proxyPowerToggle.classList.add("on");
        els.proxyPowerLabel.textContent = "Вкл";
    } else {
        els.proxyPowerToggle.classList.remove("on");
        els.proxyPowerLabel.textContent = "Выкл";
    }
}

function setupMirroring() {
    const { httpHost, httpPort, sslHost, sslPort, ftpHost, ftpPort } = els;

    sslHost.dataset.synced = "true";
    ftpHost.dataset.synced = "true";
    sslPort.dataset.synced = "true";
    ftpPort.dataset.synced = "true";

    httpHost.addEventListener("input", () => {
        if (sslHost.dataset.synced === "true") sslHost.value = httpHost.value;
        if (ftpHost.dataset.synced === "true") ftpHost.value = httpHost.value;
        markDirty();
    });

    httpPort.addEventListener("input", () => {
        if (sslPort.dataset.synced === "true") sslPort.value = httpPort.value;
        if (ftpPort.dataset.synced === "true") ftpPort.value = httpPort.value;
        markDirty();
    });

    const breakSync = el => el.addEventListener("input", () => {
        el.dataset.synced = "false";
        markDirty();
    });

    [sslHost, ftpHost, sslPort, ftpPort].forEach(breakSync);
}

async function exportSettings() {
    const d = await storageGet(null);
    const text = JSON.stringify(d, null, 2);

    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "proxy_settings.json";
    a.click();

    URL.revokeObjectURL(url);
}

async function importSettings(file) {
    try {
        const text = await file.text();
        const data = JSON.parse(text);

        if (typeof data !== "object" || data === null) {
            showStatus("Invalid settings file.");
            return;
        }

        await chrome.storage.local.clear();
        await chrome.storage.local.set(data);

        showStatus("Настройки импортированы.");

        await loadProfilesIntoUI();

        const { proxyEnabled, activeProfile } = data;
        if (proxyEnabled && activeProfile) {
            chrome.runtime.sendMessage({
                type: "applyProfile",
                name: activeProfile,
                enabled: true
            });
        }
    } catch (_) {
        showStatus("Ошибка импорта.");
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    setupMirroring();
    await loadProfilesIntoUI();

    els.saveBtn.addEventListener("click", saveProfile);
    els.resetBtn.addEventListener("click", resetProfile);
    els.deleteBtn.addEventListener("click", deleteProfile);
    els.profileSelect.addEventListener("change", profileChanged);

    els.modeToggle.addEventListener("click", toggleMode);
    els.infoIcon.addEventListener("click", toggleInfoBox);
    els.copyButton.addEventListener("click", copyText);
    els.proxyPowerToggle.addEventListener("click", toggleProxyPower);

    [
        els.targets,
        els.httpHost, els.httpPort,
        els.sslHost, els.sslPort,
        els.ftpHost, els.ftpPort,
        els.profileName,
        ...els.schemeRadios
    ].forEach(el => {
        el.addEventListener("input", markDirty);
        el.addEventListener("change", markDirty);
    });

    els.exportSettings.addEventListener("click", e => {
        e.preventDefault();
        exportSettings();
    });

    els.importSettings.addEventListener("click", e => {
        e.preventDefault();
        els.importFile.click();
    });

    els.importFile.addEventListener("change", () => {
        const f = els.importFile.files[0];
        if (f) importSettings(f);
    });
});
