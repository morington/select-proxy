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

    httpHost: document.getElementById("httpHost"),
    httpPort: document.getElementById("httpPort"),
    sslHost: document.getElementById("sslHost"),
    sslPort: document.getElementById("sslPort"),
    ftpHost: document.getElementById("ftpHost"),
    ftpPort: document.getElementById("ftpPort"),

    targets: document.getElementById("targets"),
    addCurrentBtn: document.getElementById("addCurrentBtn"),

    toggleFastProxy: document.getElementById("toggleFastProxy"),

    infoIcon: document.getElementById("infoIcon"),
    infoBox: document.getElementById("infoBox"),
    copyButton: document.getElementById("copyButton"),
    copyList: document.getElementById("copyList"),

    exportSettings: document.getElementById("exportSettings"),
    importSettings: document.getElementById("importSettings"),
    importFile: document.getElementById("importFile"),

    status: document.getElementById("status")
};

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = "12334";
const DEFAULT_SCHEME = "socks5";
const DEFAULT_MODE = "proxy";
const DEFAULT_PROFILE = "Default";

function storageGet(keys) {
    return new Promise(r => chrome.storage.local.get(keys, r));
}

function storageSet(obj) {
    return new Promise(r => chrome.storage.local.set(obj, r));
}

function storageRemove(key) {
    return new Promise(r => chrome.storage.local.remove(key, r));
}

function showStatus(t) {
    if (els.status) els.status.textContent = t || "";
}

function markDirty() {
    els.saveBtn.classList.remove("save-green");
    els.saveBtn.classList.add("save-yellow");
}

function cleanTarget(v) {
    try {
        if (v.includes("://")) return new URL(v).hostname;
        if (v.includes("/") || v.includes("?")) return new URL("http://" + v).hostname;
        return v;
    } catch {
        return v.replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
    }
}

function parseTargets(str) {
    return str
        .split(/[\n,]+/)
        .map(v => v.trim())
        .filter(Boolean)
        .map(cleanTarget);
}

function setScheme(scheme) {
    const radios = document.querySelectorAll('input[name="scheme"]');
    let found = false;
    radios.forEach(r => {
        if (r.value === scheme) {
            r.checked = true;
            found = true;
        }
    });
    if (!found) {
        radios.forEach(r => {
            if (r.value === DEFAULT_SCHEME) r.checked = true;
        });
    }
}

function getScheme() {
    const radios = document.querySelectorAll('input[name="scheme"]');
    for (const r of radios) if (r.checked) return r.value;
    return DEFAULT_SCHEME;
}

function setMode(mode) {
    if (mode === "proxy") {
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

function updatePowerToggle(on) {
    if (on) {
        els.proxyPowerToggle.classList.add("on");
        els.proxyPowerLabel.textContent = "Вкл";
    } else {
        els.proxyPowerToggle.classList.remove("on");
        els.proxyPowerLabel.textContent = "Выкл";
    }
}

function updateFastProxyToggle(on) {
    if (on) els.toggleFastProxy.classList.add("on");
    else els.toggleFastProxy.classList.remove("on");
}

async function ensureDefaults() {
    const d = await storageGet(["profiles", "activeProfile", "proxyEnabled", "showTabProxy"]);

    let profiles = d.profiles || [];
    let active = d.activeProfile;
    let showTabProxy = d.showTabProxy;

    if (showTabProxy === undefined) {
        showTabProxy = true;
        await storageSet({ showTabProxy: true });
    }

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
            showTabProxy,
            ["profile:" + DEFAULT_PROFILE]: obj
        });

        return {
            profiles,
            activeProfile: DEFAULT_PROFILE,
            proxyEnabled: false,
            showTabProxy
        };
    }

    if (!active || !profiles.includes(active)) {
        active = profiles[0];
        await storageSet({ activeProfile: active });
    }

    return {
        profiles,
        activeProfile: active,
        proxyEnabled: d.proxyEnabled ?? false,
        showTabProxy
    };
}

async function loadProfile(name) {
    const d = await storageGet("profile:" + name);
    const p = d["profile:" + name];

    if (!p) {
        fillDefaultForm();
        els.saveBtn.classList.add("save-yellow");
        return;
    }

    els.targets.value = (p.targets || []).join(", ");
    els.httpHost.value = p.http?.host || DEFAULT_HOST;
    els.httpPort.value = p.http?.port || DEFAULT_PORT;
    els.sslHost.value = p.ssl?.host || DEFAULT_HOST;
    els.sslPort.value = p.ssl?.port || DEFAULT_PORT;
    els.ftpHost.value = p.ftp?.host || DEFAULT_HOST;
    els.ftpPort.value = p.ftp?.port || DEFAULT_PORT;

    setScheme(p.scheme || DEFAULT_SCHEME);
    setMode(p.mode || DEFAULT_MODE);

    els.saveBtn.classList.add("save-green");
    els.saveBtn.classList.remove("save-yellow");
    showStatus("");
}

function fillDefaultForm() {
    els.targets.value = "";
    els.httpHost.value = DEFAULT_HOST;
    els.httpPort.value = DEFAULT_PORT;
    els.sslHost.value = DEFAULT_HOST;
    els.sslPort.value = DEFAULT_PORT;
    els.ftpHost.value = DEFAULT_HOST;
    els.ftpPort.value = DEFAULT_PORT;

    setScheme(DEFAULT_SCHEME);
    setMode(DEFAULT_MODE);
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
    updateFastProxyToggle(d.showTabProxy);

    await loadProfile(d.activeProfile);
}

async function saveProfile() {
    const name = els.profileName.value.trim();
    if (!name) return;

    const p = {
        name,
        targets: parseTargets(els.targets.value),
        http: { host: els.httpHost.value.trim(), port: els.httpPort.value.trim() },
        ssl: { host: els.sslHost.value.trim(), port: els.sslPort.value.trim() },
        ftp: { host: els.ftpHost.value.trim(), port: els.ftpPort.value.trim() },
        scheme: getScheme(),
        mode: getMode()
    };

    const d = await storageGet("profiles");
    let profiles = d.profiles || [];

    profiles.push(name);
    profiles = [...new Set(profiles)];

    const obj = { profiles, activeProfile: name };
    obj["profile:" + name] = p;

    await storageSet(obj);
    await loadProfilesIntoUI();
    await applyCurrentProfile();

    els.saveBtn.classList.add("save-green");
    els.saveBtn.classList.remove("save-yellow");

    showStatus("Профиль сохранён");
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
    }

    showStatus("Удалено");
}

async function resetProfile() {
    const name = els.profileName.value.trim();
    if (!name) return;

    await loadProfile(name);

    els.saveBtn.classList.add("save-green");
    els.saveBtn.classList.remove("save-yellow");

    showStatus("Восстановлено");
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

async function toggleProxyPower() {
    const d = await storageGet("proxyEnabled");
    const next = !d.proxyEnabled;

    await storageSet({ proxyEnabled: next });
    updatePowerToggle(next);

    chrome.runtime.sendMessage({ type: "proxyPower", enabled: next });

    if (next) {
        applyCurrentProfile();
        showStatus("Прокси включён");
    } else {
        showStatus("Прокси выключен");
    }
}

async function toggleFastProxy() {
    const d = await storageGet("showTabProxy");
    const next = !d.showTabProxy;

    await storageSet({ showTabProxy: next });
    updateFastProxyToggle(next);

    chrome.tabs.query({}, tabs => {
        tabs.forEach(t => {
            chrome.tabs.sendMessage(t.id, {
                type: "updateFastProxyVisibility",
                visible: next
            });
        });
    });
}

async function addCurrentSite() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs.length) return;

    let host = "";
    try { host = new URL(tabs[0].url).hostname; } catch {}

    if (!host) return;

    const parts = host.split(".");
    if (parts.length < 2) return;

    const root = parts.slice(-2).join(".");
    const wildcard = "*." + root;

    const existing = parseTargets(els.targets.value);
    const add = [];

    if (!existing.includes(root)) add.push(root);
    if (!existing.includes(wildcard)) add.push(wildcard);

    if (!add.length) {
        showStatus("Уже существует");
        return;
    }

    els.targets.value =
        add.join("\n") +
        "\n" +
        els.targets.value.trim();

    markDirty();
    showStatus("Добавлено: " + add.join(", "));
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
        const txt = await file.text();
        const obj = JSON.parse(txt);

        if (!obj || typeof obj !== "object") {
            showStatus("Некорректный файл");
            return;
        }

        await chrome.storage.local.clear();
        await chrome.storage.local.set(obj);
        await loadProfilesIntoUI();

        showStatus("Импортировано");
    } catch {
        showStatus("Ошибка импорта");
    }
}

async function applyCurrentProfile() {
    const d = await storageGet(["activeProfile", "proxyEnabled"]);
    chrome.runtime.sendMessage({
        type: "applyProfile",
        name: d.activeProfile,
        enabled: d.proxyEnabled
    });
}

document.addEventListener("DOMContentLoaded", async () => {
    await loadProfilesIntoUI();

    els.saveBtn.addEventListener("click", saveProfile);
    els.deleteBtn.addEventListener("click", deleteProfile);
    els.resetBtn.addEventListener("click", resetProfile);

    els.profileSelect.addEventListener("change", profileChanged);

    els.proxyPowerToggle.addEventListener("click", toggleProxyPower);

    els.modeToggle.addEventListener("click", () => {
        markDirty();
        const on = els.modeToggle.classList.toggle("on");
        els.modeText.textContent = on
            ? "Введённые адреса будут исключаться"
            : "Введённые адреса будут проксироваться";
    });

    els.toggleFastProxy.addEventListener("click", toggleFastProxy);

    els.addCurrentBtn.addEventListener("click", addCurrentSite);

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

    const formInputs = [
        els.targets,
        els.profileName,
        els.httpHost, els.httpPort,
        els.sslHost, els.sslPort,
        els.ftpHost, els.ftpPort,
        ...document.querySelectorAll('input[name="scheme"]')
    ];

    formInputs.forEach(el => {
        if (!el) return;
        el.addEventListener("input", markDirty);
        el.addEventListener("change", markDirty);
    });

    els.infoIcon.addEventListener("click", () => {
        els.infoBox.classList.toggle("show");
    });

    els.copyButton.addEventListener("click", () => {
        navigator.clipboard.writeText(els.copyList.textContent.trim());
        showStatus("Скопировано");
    });
});
