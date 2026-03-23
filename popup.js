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

    proxyUsername: document.getElementById("proxyUsername"),
    proxyPassword: document.getElementById("proxyPassword"),
    clearSecretBtn: document.getElementById("clearSecretBtn"),
    secretState: document.getElementById("secretState"),

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

    openErrorMonitor: document.getElementById("openErrorMonitor"),
    openLogMonitor: document.getElementById("openLogMonitor"),

    proxyDetails: document.getElementById("proxyDetails"),
    checkProxyIpBtn: document.getElementById("checkProxyIpBtn"),
    toggleIpVisibilityBtn: document.getElementById("toggleIpVisibilityBtn"),
    openIpCheckerBtn: document.getElementById("openIpCheckerBtn"),
    proxyIpBox: document.getElementById("proxyIpBox"),
    proxyIpValue: document.getElementById("proxyIpValue"),

    status: document.getElementById("status")
};

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = "12334";
const DEFAULT_SCHEME = "socks5";
const DEFAULT_MODE = "proxy";
const DEFAULT_PROFILE = "Default";
const LOG_STORAGE_KEY = "extensionLogs";
const IP_CHECK_URL = "https://api.ipify.org?format=json";
const IP_CHECKER_PAGE_URL = "https://www.ipify.org/";

let fetchedIp = "";
let isIpVisible = false;

function storageGet(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function storageSet(obj) {
    return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
}

function storageRemove(key) {
    return new Promise((resolve) => chrome.storage.local.remove(key, resolve));
}

function showStatus(text, isError = false) {
    if (!els.status) {
        return;
    }

    els.status.textContent = text || "";
    els.status.style.color = isError ? "#fca5a5" : "#9ca3af";
}

function markDirty() {
    els.saveBtn.classList.remove("button-green");
    els.saveBtn.classList.add("button-yellow");
}

function setSavedState() {
    els.saveBtn.classList.add("button-green");
    els.saveBtn.classList.remove("button-yellow");
}

function cleanTarget(value) {
    try {
        if (value.includes("://")) {
            return new URL(value).hostname;
        }

        if (value.includes("/") || value.includes("?")) {
            return new URL(`http://${value}`).hostname;
        }

        return value;
    } catch {
        return value.replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
    }
}

function parseTargets(str) {
    return str
        .split(/[\n,]+/)
        .map((value) => value.trim())
        .filter(Boolean)
        .map(cleanTarget);
}

function setScheme(scheme) {
    const radios = document.querySelectorAll('input[name="scheme"]');
    let found = false;

    radios.forEach((radio) => {
        if (radio.value === scheme) {
            radio.checked = true;
            found = true;
        }
    });

    if (!found) {
        radios.forEach((radio) => {
            if (radio.value === DEFAULT_SCHEME) {
                radio.checked = true;
            }
        });
    }
}

function getScheme() {
    const radios = document.querySelectorAll('input[name="scheme"]');
    for (const radio of radios) {
        if (radio.checked) {
            return radio.value;
        }
    }

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

function updatePowerToggle(enabled) {
    if (enabled) {
        els.proxyPowerToggle.classList.add("on");
        els.proxyPowerLabel.textContent = "Вкл";
    } else {
        els.proxyPowerToggle.classList.remove("on");
        els.proxyPowerLabel.textContent = "Выкл";
    }
}

function updateFastProxyToggle(enabled) {
    if (enabled) {
        els.toggleFastProxy.classList.add("on");
    } else {
        els.toggleFastProxy.classList.remove("on");
    }
}

function maskIp(ip) {
    if (!ip) {
        return "••••••••";
    }

    return "••••••••";
}

function renderIpValue() {
    els.proxyIpBox.classList.toggle("show", Boolean(fetchedIp));
    els.toggleIpVisibilityBtn.disabled = !fetchedIp;
    els.proxyIpValue.textContent = isIpVisible ? fetchedIp : maskIp(fetchedIp);
    els.toggleIpVisibilityBtn.textContent = isIpVisible ? "Скрыть IP" : "Показать IP";
}

function resetIpState() {
    fetchedIp = "";
    isIpVisible = false;
    renderIpValue();
}

async function updateSecretState(profileName) {
    if (!profileName) {
        els.secretState.textContent = "Пароль нигде не сохраняется";
        return;
    }

    const response = await chrome.runtime.sendMessage({
        type: "getProfileSecretState",
        profileName
    });

    els.secretState.textContent = response?.hasSecret
        ? "Пароль введён для текущей сессии"
        : "Пароль нигде не сохраняется";
}

async function ensureDefaults() {
    const data = await storageGet(["profiles", "activeProfile", "proxyEnabled", "showTabProxy"]);

    let profiles = data.profiles || [];
    let activeProfile = data.activeProfile;
    let showTabProxy = data.showTabProxy;

    if (showTabProxy === undefined) {
        showTabProxy = true;
        await storageSet({ showTabProxy: true });
    }

    if (!profiles.length) {
        profiles = [DEFAULT_PROFILE];

        const profile = {
            name: DEFAULT_PROFILE,
            targets: [],
            http: { host: DEFAULT_HOST, port: DEFAULT_PORT },
            ssl: { host: DEFAULT_HOST, port: DEFAULT_PORT },
            ftp: { host: DEFAULT_HOST, port: DEFAULT_PORT },
            scheme: DEFAULT_SCHEME,
            mode: DEFAULT_MODE,
            auth: { username: "" }
        };

        await storageSet({
            profiles,
            activeProfile: DEFAULT_PROFILE,
            proxyEnabled: false,
            showTabProxy,
            [`profile:${DEFAULT_PROFILE}`]: profile
        });

        return {
            profiles,
            activeProfile: DEFAULT_PROFILE,
            proxyEnabled: false,
            showTabProxy
        };
    }

    if (!activeProfile || !profiles.includes(activeProfile)) {
        activeProfile = profiles[0];
        await storageSet({ activeProfile });
    }

    return {
        profiles,
        activeProfile,
        proxyEnabled: data.proxyEnabled ?? false,
        showTabProxy
    };
}

async function loadProfile(name) {
    const data = await storageGet(`profile:${name}`);
    const profile = data[`profile:${name}`];

    if (!profile) {
        fillDefaultForm();
        markDirty();
        return;
    }

    els.targets.value = (profile.targets || []).join(", ");
    els.httpHost.value = profile.http?.host || DEFAULT_HOST;
    els.httpPort.value = profile.http?.port || DEFAULT_PORT;
    els.sslHost.value = profile.ssl?.host || DEFAULT_HOST;
    els.sslPort.value = profile.ssl?.port || DEFAULT_PORT;
    els.ftpHost.value = profile.ftp?.host || DEFAULT_HOST;
    els.ftpPort.value = profile.ftp?.port || DEFAULT_PORT;
    els.proxyUsername.value = profile.auth?.username || "";
    els.proxyPassword.value = "";

    setScheme(profile.scheme || DEFAULT_SCHEME);
    setMode(profile.mode || DEFAULT_MODE);

    setSavedState();
    resetIpState();
    showStatus("");
    await updateSecretState(name);
}

function fillDefaultForm() {
    els.targets.value = "";
    els.httpHost.value = DEFAULT_HOST;
    els.httpPort.value = DEFAULT_PORT;
    els.sslHost.value = DEFAULT_HOST;
    els.sslPort.value = DEFAULT_PORT;
    els.ftpHost.value = DEFAULT_HOST;
    els.ftpPort.value = DEFAULT_PORT;
    els.proxyUsername.value = "";
    els.proxyPassword.value = "";

    setScheme(DEFAULT_SCHEME);
    setMode(DEFAULT_MODE);
    resetIpState();
}

async function loadProfilesIntoUI() {
    const data = await ensureDefaults();

    els.profileSelect.textContent = "";
    data.profiles.forEach((name) => {
        const option = document.createElement("option");
        option.value = name;
        option.textContent = name;
        els.profileSelect.appendChild(option);
    });

    els.profileSelect.value = data.activeProfile;
    els.profileName.value = data.activeProfile;

    updatePowerToggle(data.proxyEnabled);
    updateFastProxyToggle(data.showTabProxy);

    await loadProfile(data.activeProfile);
}

async function saveProfile() {
    const name = els.profileName.value.trim();
    if (!name) {
        showStatus("Название профиля пустое", true);
        return;
    }

    const profile = {
        name,
        targets: parseTargets(els.targets.value),
        http: { host: els.httpHost.value.trim(), port: els.httpPort.value.trim() },
        ssl: { host: els.sslHost.value.trim(), port: els.sslPort.value.trim() },
        ftp: { host: els.ftpHost.value.trim(), port: els.ftpPort.value.trim() },
        scheme: getScheme(),
        mode: getMode(),
        auth: {
            username: els.proxyUsername.value.trim()
        }
    };

    const data = await storageGet("profiles");
    let profiles = data.profiles || [];

    profiles.push(name);
    profiles = [...new Set(profiles)];

    const payload = { profiles, activeProfile: name };
    payload[`profile:${name}`] = profile;

    await storageSet(payload);

    const password = els.proxyPassword.value;
    if (password) {
        await chrome.runtime.sendMessage({
            type: "setProfileSecret",
            profileName: name,
            username: profile.auth.username,
            password
        });
    }

    await loadProfilesIntoUI();
    await applyCurrentProfile();

    setSavedState();
    showStatus("Профиль сохранён");
}

async function deleteProfile() {
    const name = els.profileName.value.trim();
    const data = await storageGet(["profiles", "activeProfile"]);

    let profiles = data.profiles || [];
    profiles = profiles.filter((item) => item !== name);

    const payload = { profiles };

    if (data.activeProfile === name) {
        payload.activeProfile = profiles[0] || null;
    }

    await storageRemove(`profile:${name}`);
    await chrome.runtime.sendMessage({
        type: "clearProfileSecret",
        profileName: name
    });
    await storageSet(payload);

    if (profiles.length) {
        els.profileSelect.value = profiles[0];
        els.profileName.value = profiles[0];
        await loadProfile(profiles[0]);
        await applyCurrentProfile();
    } else {
        fillDefaultForm();
    }

    showStatus("Профиль удалён");
}

async function resetProfile() {
    const name = els.profileName.value.trim();
    if (!name) {
        return;
    }

    await loadProfile(name);
    setSavedState();
    showStatus("Форма восстановлена");
}

async function profileChanged() {
    const name = els.profileSelect.value;
    els.profileName.value = name;

    await storageSet({ activeProfile: name });
    await loadProfile(name);
    await applyCurrentProfile();

    setSavedState();
}

async function toggleProxyPower() {
    const data = await storageGet("proxyEnabled");
    const next = !data.proxyEnabled;

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
    const data = await storageGet("showTabProxy");
    const next = !data.showTabProxy;

    await storageSet({ showTabProxy: next });
    updateFastProxyToggle(next);

    chrome.tabs.query({}, (tabs) => {
        tabs.forEach((tab) => {
            chrome.tabs.sendMessage(tab.id, {
                type: "updateFastProxyVisibility",
                visible: next
            });
        });
    });

    showStatus(next ? "Быстрая кнопка включена" : "Быстрая кнопка выключена");
}

async function addCurrentSite() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs.length) {
        return;
    }

    let host = "";
    try {
        host = new URL(tabs[0].url).hostname;
    } catch {}

    if (!host) {
        showStatus("Не удалось определить хост", true);
        return;
    }

    const parts = host.split(".");
    if (parts.length < 2) {
        return;
    }

    const root = parts.slice(-2).join(".");
    const wildcard = `*.${root}`;

    const existing = parseTargets(els.targets.value);
    const itemsToAdd = [];

    if (!existing.includes(root)) {
        itemsToAdd.push(root);
    }

    if (!existing.includes(wildcard)) {
        itemsToAdd.push(wildcard);
    }

    if (!itemsToAdd.length) {
        showStatus("Адрес уже есть");
        return;
    }

    const currentValue = els.targets.value.trim();
    const addition = itemsToAdd.join(", ");
    els.targets.value = currentValue ? `${currentValue}, ${addition}` : addition;

    markDirty();
    showStatus(`Добавлено: ${itemsToAdd.join(", ")}`);
}

async function exportSettings() {
    const data = await storageGet(null);
    const exportData = { ...data };

    delete exportData[LOG_STORAGE_KEY];

    const text = JSON.stringify({
        ...exportData,
        exportInfo: {
            exportedAt: new Date().toISOString(),
            note: "Пароли прокси и логи не входят в экспорт"
        }
    }, null, 2);

    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = "select_proxy_settings.json";
    link.click();

    URL.revokeObjectURL(url);

    showStatus("Экспортировано");
}

async function importSettings(file) {
    try {
        const text = await file.text();
        const parsed = JSON.parse(text);

        if (!parsed || typeof parsed !== "object") {
            showStatus("Некорректный файл", true);
            return;
        }

        const currentLogs = await storageGet(LOG_STORAGE_KEY);

        delete parsed.exportInfo;
        delete parsed[LOG_STORAGE_KEY];

        await chrome.storage.local.clear();
        await chrome.storage.local.set(parsed);

        if (Array.isArray(currentLogs[LOG_STORAGE_KEY])) {
            await chrome.storage.local.set({
                [LOG_STORAGE_KEY]: currentLogs[LOG_STORAGE_KEY]
            });
        }

        await loadProfilesIntoUI();
        showStatus("Импортировано");
    } catch {
        showStatus("Ошибка импорта", true);
    }
}

async function applyCurrentProfile() {
    const data = await storageGet(["activeProfile", "proxyEnabled"]);
    chrome.runtime.sendMessage({
        type: "applyProfile",
        name: data.activeProfile,
        enabled: data.proxyEnabled
    });
}

async function openErrorMonitor() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs[0];

    if (!activeTab || typeof activeTab.id !== "number") {
        showStatus("Не удалось определить текущую вкладку", true);
        return;
    }

    const url = new URL(chrome.runtime.getURL("error_monitor.html"));
    url.searchParams.set("tabId", String(activeTab.id));
    url.searchParams.set("sourceWindowId", String(activeTab.windowId));
    url.searchParams.set("title", activeTab.title || "");
    url.searchParams.set("sourceUrl", activeTab.url || "");

    chrome.windows.create({
        url: url.toString(),
        type: "popup",
        width: 520,
        height: 620
    });
}

function openLogMonitor() {
    chrome.windows.create({
        url: chrome.runtime.getURL("log_monitor.html"),
        type: "popup",
        width: 760,
        height: 680
    });
}

async function clearSecret() {
    const profileName = els.profileName.value.trim();
    if (!profileName) {
        return;
    }

    await chrome.runtime.sendMessage({
        type: "clearProfileSecret",
        profileName
    });

    els.proxyPassword.value = "";
    await updateSecretState(profileName);
    showStatus("Пароль очищен");
}

async function checkProxyIp() {
    els.checkProxyIpBtn.disabled = true;
    els.checkProxyIpBtn.textContent = "Проверка...";

    try {
        const response = await fetch(IP_CHECK_URL, {
            method: "GET",
            cache: "no-store"
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const payload = await response.json();
        if (!payload?.ip) {
            throw new Error("IP не найден");
        }

        fetchedIp = String(payload.ip);
        isIpVisible = false;
        renderIpValue();
        showStatus("IP получен");
    } catch (error) {
        resetIpState();
        showStatus(`Не удалось получить IP: ${String(error?.message || error)}`, true);
    } finally {
        els.checkProxyIpBtn.disabled = false;
        els.checkProxyIpBtn.textContent = "Проверить IP";
    }
}

function toggleIpVisibility() {
    if (!fetchedIp) {
        return;
    }

    isIpVisible = !isIpVisible;
    renderIpValue();
}

function openIpCheckerPage(event) {
    event.preventDefault();
    chrome.tabs.create({
        url: IP_CHECKER_PAGE_URL
    });
}

document.addEventListener("DOMContentLoaded", async () => {
    await loadProfilesIntoUI();
    renderIpValue();

    els.saveBtn.addEventListener("click", saveProfile);
    els.deleteBtn.addEventListener("click", deleteProfile);
    els.resetBtn.addEventListener("click", resetProfile);

    els.profileSelect.addEventListener("change", profileChanged);
    els.proxyPowerToggle.addEventListener("click", toggleProxyPower);
    els.toggleFastProxy.addEventListener("click", toggleFastProxy);
    els.addCurrentBtn.addEventListener("click", addCurrentSite);
    els.clearSecretBtn.addEventListener("click", clearSecret);

    els.modeToggle.addEventListener("click", () => {
        markDirty();
        const enabled = els.modeToggle.classList.toggle("on");
        els.modeText.textContent = enabled
            ? "Введённые адреса будут исключаться"
            : "Введённые адреса будут проксироваться";
    });

    els.exportSettings.addEventListener("click", (event) => {
        event.preventDefault();
        exportSettings();
    });

    els.importSettings.addEventListener("click", (event) => {
        event.preventDefault();
        els.importFile.click();
    });

    els.importFile.addEventListener("change", () => {
        const file = els.importFile.files[0];
        if (file) {
            importSettings(file);
        }
    });

    els.openErrorMonitor.addEventListener("click", async (event) => {
        event.preventDefault();
        await openErrorMonitor();
    });

    els.openLogMonitor.addEventListener("click", (event) => {
        event.preventDefault();
        openLogMonitor();
    });

    els.checkProxyIpBtn.addEventListener("click", checkProxyIp);
    els.toggleIpVisibilityBtn.addEventListener("click", toggleIpVisibility);
    els.openIpCheckerBtn.addEventListener("click", openIpCheckerPage);

    const formInputs = [
        els.targets,
        els.profileName,
        els.httpHost,
        els.httpPort,
        els.sslHost,
        els.sslPort,
        els.ftpHost,
        els.ftpPort,
        els.proxyUsername,
        els.proxyPassword,
        ...document.querySelectorAll('input[name="scheme"]')
    ];

    formInputs.forEach((element) => {
        if (!element) {
            return;
        }

        element.addEventListener("input", markDirty);
        element.addEventListener("change", markDirty);
    });

    els.infoIcon.addEventListener("click", () => {
        els.infoBox.classList.toggle("show");
    });

    els.copyButton.addEventListener("click", () => {
        navigator.clipboard.writeText(els.copyList.textContent.trim());
        showStatus("Скопировано");
    });
});