const tabProxy = {};
const tabHosts = {};
const hostRefs = {};
const errorUrlsByTabId = {};
const authRequestAttempts = {};

const LOG_STORAGE_KEY = "extensionLogs";
const MAX_LOG_ENTRIES = 500;

function getHostFromUrl(url) {
    try {
        return new URL(url).hostname.toLowerCase();
    } catch (_) {
        return "";
    }
}

function isIpAddress(host) {
    return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
}

function getRootDomain(host) {
    const normalizedHost = (host || "").toLowerCase().trim();

    if (!normalizedHost || normalizedHost === "localhost" || isIpAddress(normalizedHost)) {
        return normalizedHost;
    }

    const parts = normalizedHost.split(".").filter(Boolean);
    if (parts.length < 2) {
        return normalizedHost;
    }

    return parts.slice(-2).join(".");
}

function getHostPatterns(host) {
    const normalizedHost = (host || "").toLowerCase().trim();
    if (!normalizedHost) {
        return [];
    }

    if (normalizedHost === "localhost" || isIpAddress(normalizedHost)) {
        return [normalizedHost];
    }

    const rootDomain = getRootDomain(normalizedHost);
    if (!rootDomain) {
        return [normalizedHost];
    }

    return [...new Set([rootDomain, `*.${rootDomain}`])];
}

function nowIso() {
    return new Date().toISOString();
}

async function appendLog(level, event, details = {}) {
    try {
        const data = await chrome.storage.local.get(LOG_STORAGE_KEY);
        const logs = Array.isArray(data[LOG_STORAGE_KEY]) ? data[LOG_STORAGE_KEY] : [];

        logs.push({
            ts: nowIso(),
            level,
            event,
            details
        });

        const sliced = logs.slice(-MAX_LOG_ENTRIES);

        await chrome.storage.local.set({
            [LOG_STORAGE_KEY]: sliced
        });
    } catch (_) {}
}

async function getLogs() {
    const data = await chrome.storage.local.get(LOG_STORAGE_KEY);
    return Array.isArray(data[LOG_STORAGE_KEY]) ? data[LOG_STORAGE_KEY] : [];
}

async function clearLogs() {
    await chrome.storage.local.set({
        [LOG_STORAGE_KEY]: []
    });
}

async function loadImage(path) {
    const url = chrome.runtime.getURL(path);
    const response = await fetch(url);
    const blob = await response.blob();
    return await createImageBitmap(blob);
}

async function createIconWithBackground(size, rgb) {
    const bitmap = await loadImage(`icons/${size}.png`);
    const canvas = new OffscreenCanvas(size, size);
    const context = canvas.getContext("2d");

    context.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    context.beginPath();
    context.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    context.fill();
    context.drawImage(bitmap, 0, 0, size, size);

    return context.getImageData(0, 0, size, size);
}

async function setIconColor(rgb) {
    const sizes = [24, 32, 48, 64];
    const imageData = {};

    for (const size of sizes) {
        imageData[size] = await createIconWithBackground(size, rgb);
    }

    chrome.action.setIcon({ imageData });
}

function formatEntry(type, host, port) {
    if (!host || !port) {
        return null;
    }

    if (type === "socks5") {
        return `SOCKS5 ${host}:${port}`;
    }

    if (type === "socks4") {
        return `SOCKS4 ${host}:${port}`;
    }

    if (type === "http") {
        return `PROXY ${host}:${port}`;
    }

    if (type === "https") {
        return `HTTPS ${host}:${port}`;
    }

    return null;
}

function buildProxyString(scheme, http, ssl, ftp) {
    const entries = [];

    const httpEntry = formatEntry(scheme, http.host, http.port);
    if (httpEntry) {
        entries.push(httpEntry);
    }

    const sslEntry = formatEntry(scheme, ssl.host, ssl.port);
    if (sslEntry) {
        entries.push(sslEntry);
    }

    const ftpEntry = formatEntry(scheme, ftp.host, ftp.port);
    if (ftpEntry) {
        entries.push(ftpEntry);
    }

    return entries.join("; ");
}

function buildPac(mode, listStr, proxyStr, overrideStr) {
    return `
function FindProxyForURL(url, host) {
  var override = ${overrideStr};

  function match(list, currentHost) {
    for (var i = 0; i < list.length; i++) {
      var pattern = list[i];
      if (pattern.indexOf("*.") === 0) {
        if (dnsDomainIs(currentHost, pattern.substring(1))) return true;
      } else if (currentHost === pattern) {
        return true;
      }
    }
    return false;
  }

  if (match(override, host)) return "${proxyStr}";

  var targets = ${listStr};

  if ("${mode}" === "proxy") {
    if (match(targets, host)) return "${proxyStr}";
    return "DIRECT";
  }

  if (match(targets, host)) return "DIRECT";
  return "${proxyStr}";
}`;
}

function getProfile(name) {
    return new Promise((resolve) => {
        chrome.storage.local.get(`profile:${name}`, (data) => {
            resolve(data[`profile:${name}`] || null);
        });
    });
}

async function getActiveProfileInfo() {
    const data = await chrome.storage.local.get(["activeProfile", "proxyEnabled"]);
    const activeProfileName = data.activeProfile || null;

    if (!activeProfileName) {
        return {
            activeProfileName: null,
            profile: null,
            proxyEnabled: Boolean(data.proxyEnabled)
        };
    }

    const profile = await getProfile(activeProfileName);

    return {
        activeProfileName,
        profile,
        proxyEnabled: Boolean(data.proxyEnabled)
    };
}

async function saveProfile(profileName, profile) {
    await chrome.storage.local.set({
        [`profile:${profileName}`]: profile
    });
}

async function applyProfile(name, enabled) {
    if (!enabled) {
        disableProxy();
        return;
    }

    const profile = await getProfile(name);
    if (!profile) {
        disableProxy();
        await appendLog("warn", "profile_missing_on_apply", { profileName: name });
        return;
    }

    const listStr = JSON.stringify(profile.targets || []);
    const proxyStr = buildProxyString(profile.scheme, profile.http, profile.ssl, profile.ftp);
    const overrideHosts = Object.keys(hostRefs).filter((host) => hostRefs[host] > 0);
    const overrideStr = JSON.stringify(overrideHosts);
    const pac = buildPac(profile.mode, listStr, proxyStr, overrideStr);

    chrome.proxy.settings.set(
        {
            value: { mode: "pac_script", pacScript: { data: pac } },
            scope: "regular"
        },
        () => {}
    );

    setIconColor([46, 204, 113]);

    await appendLog("info", "profile_applied", {
        profileName: name,
        mode: profile.mode || "proxy",
        targetsCount: Array.isArray(profile.targets) ? profile.targets.length : 0,
        scheme: profile.scheme || "socks5",
        httpHost: profile.http?.host || "",
        httpPort: profile.http?.port || ""
    });
}

async function enableProxy() {
    const data = await chrome.storage.local.get("activeProfile");
    if (!data.activeProfile) {
        await appendLog("warn", "proxy_enable_without_profile");
        return;
    }

    setIconColor([46, 204, 113]);
    await appendLog("info", "proxy_enabled", { profileName: data.activeProfile });
    applyProfile(data.activeProfile, true);
}

function disableProxy() {
    chrome.proxy.settings.clear({ scope: "regular" });
    setIconColor([231, 76, 60]);
    appendLog("info", "proxy_disabled");
}

function addHostForTab(tabId, host) {
    if (!host) {
        return;
    }

    if (!tabHosts[tabId]) {
        tabHosts[tabId] = new Set();
    }

    if (!tabHosts[tabId].has(host)) {
        tabHosts[tabId].add(host);
        hostRefs[host] = (hostRefs[host] || 0) + 1;
    }
}

function clearTabHosts(tabId) {
    const set = tabHosts[tabId];
    if (!set) {
        return;
    }

    for (const host of set) {
        hostRefs[host] = (hostRefs[host] || 0) - 1;
        if (hostRefs[host] <= 0) {
            delete hostRefs[host];
        }
    }

    delete tabHosts[tabId];
    delete tabProxy[tabId];
}

async function refreshPacIfNeeded() {
    const data = await chrome.storage.local.get(["activeProfile", "proxyEnabled"]);
    if (!data.proxyEnabled || !data.activeProfile) {
        return;
    }

    applyProfile(data.activeProfile, true);
}

function addErrorToTab(tabId, url, errorMessage, statusCode = null) {
    if (tabId === -1) {
        return;
    }

    const host = getHostFromUrl(url);
    if (!host) {
        return;
    }

    if (!errorUrlsByTabId[tabId]) {
        errorUrlsByTabId[tabId] = [];
    }

    const key = `${host}:::${errorMessage}`;
    const currentTime = Date.now();

    const existing = errorUrlsByTabId[tabId].find((item) => item.key === key);
    if (existing) {
        existing.count += 1;
        existing.lastSeen = currentTime;
        existing.lastUrl = url;
        existing.statusCode = statusCode;
        return;
    }

    errorUrlsByTabId[tabId].push({
        key,
        host,
        errorMessage,
        statusCode,
        count: 1,
        lastSeen: currentTime,
        lastUrl: url
    });

    appendLog("warn", "network_error_captured", {
        tabId,
        host,
        errorMessage,
        statusCode,
        url
    });
}

function getErrorsForTab(tabId) {
    if (tabId == null || !errorUrlsByTabId[tabId]) {
        return [];
    }

    return [...errorUrlsByTabId[tabId]].sort((left, right) => right.lastSeen - left.lastSeen);
}

function clearErrorsForTab(tabId) {
    if (tabId == null) {
        return;
    }

    delete errorUrlsByTabId[tabId];
    appendLog("info", "tab_errors_cleared", { tabId });
}

function matchesTargetPattern(host, target) {
    const normalizedHost = (host || "").toLowerCase().trim();
    const normalizedTarget = (target || "").toLowerCase().trim();

    if (!normalizedHost || !normalizedTarget) {
        return false;
    }

    if (normalizedTarget.startsWith("*.")) {
        return normalizedHost.endsWith(normalizedTarget.slice(1));
    }

    return normalizedHost === normalizedTarget;
}

async function getHostMonitorState(host) {
    const normalizedHost = (host || "").toLowerCase().trim();
    const { activeProfileName, profile, proxyEnabled } = await getActiveProfileInfo();

    if (!activeProfileName || !profile) {
        return {
            hasProfile: false,
            profileName: null,
            proxyEnabled,
            mode: "proxy",
            targets: [],
            host,
            patterns: getHostPatterns(normalizedHost),
            isInTargets: false,
            matchedTargets: [],
            actionLabel: "Добавить в адреса",
            removeLabel: "Удалить из адресов"
        };
    }

    const targets = Array.isArray(profile.targets) ? profile.targets : [];
    const matchedTargets = targets.filter((target) => matchesTargetPattern(normalizedHost, target));
    const isInTargets = matchedTargets.length > 0;
    const mode = profile.mode || "proxy";

    return {
        hasProfile: true,
        profileName: activeProfileName,
        proxyEnabled,
        mode,
        targets,
        host: normalizedHost,
        patterns: getHostPatterns(normalizedHost),
        isInTargets,
        matchedTargets,
        actionLabel: "Добавить в адреса",
        removeLabel:
            mode === "proxy"
                ? "Удалить из проксирования"
                : "Удалить из игнорирования"
    };
}

async function addHostToActiveProfileTargets(host) {
    const normalizedHost = (host || "").toLowerCase().trim();
    const { activeProfileName, profile } = await getActiveProfileInfo();

    if (!activeProfileName || !profile) {
        return {
            success: false,
            message: "Активный профиль не найден"
        };
    }

    const patterns = getHostPatterns(normalizedHost);
    const currentTargets = Array.isArray(profile.targets) ? profile.targets : [];
    const nextTargets = [...currentTargets];

    for (const pattern of patterns) {
        if (!nextTargets.includes(pattern)) {
            nextTargets.push(pattern);
        }
    }

    profile.targets = nextTargets;
    await saveProfile(activeProfileName, profile);
    await refreshPacIfNeeded();

    await appendLog("info", "targets_added_from_monitor", {
        profileName: activeProfileName,
        host: normalizedHost,
        added: patterns
    });

    return {
        success: true,
        mode: profile.mode || "proxy",
        added: patterns,
        targets: nextTargets
    };
}

async function removeHostFromActiveProfileTargets(host) {
    const normalizedHost = (host || "").toLowerCase().trim();
    const { activeProfileName, profile } = await getActiveProfileInfo();

    if (!activeProfileName || !profile) {
        return {
            success: false,
            message: "Активный профиль не найден"
        };
    }

    const currentTargets = Array.isArray(profile.targets) ? profile.targets : [];
    const nextTargets = [];
    const removed = [];

    for (const target of currentTargets) {
        if (matchesTargetPattern(normalizedHost, target)) {
            removed.push(target);
        } else {
            nextTargets.push(target);
        }
    }

    profile.targets = nextTargets;
    await saveProfile(activeProfileName, profile);
    await refreshPacIfNeeded();

    await appendLog("info", "targets_removed_from_monitor", {
        profileName: activeProfileName,
        host: normalizedHost,
        removed
    });

    return {
        success: true,
        mode: profile.mode || "proxy",
        removed,
        targets: nextTargets
    };
}

async function getProfileSecret(profileName) {
    const key = `proxySecret:${profileName}`;
    const data = await chrome.storage.session.get(key);
    return data[key] || null;
}

async function setProfileSecret(profileName, username, password) {
    const key = `proxySecret:${profileName}`;

    if (!password) {
        return {
            success: false,
            message: "Пароль пустой"
        };
    }

    await chrome.storage.session.set({
        [key]: {
            username: username || "",
            password
        }
    });

    await appendLog("info", "proxy_secret_saved", {
        profileName,
        hasUsername: Boolean(username)
    });

    return {
        success: true
    };
}

async function clearProfileSecret(profileName) {
    const key = `proxySecret:${profileName}`;
    await chrome.storage.session.remove(key);

    await appendLog("info", "proxy_secret_cleared", {
        profileName
    });

    return {
        success: true
    };
}

async function getProfileSecretState(profileName) {
    const secret = await getProfileSecret(profileName);
    return {
        hasSecret: Boolean(secret?.password)
    };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "applyProfile") {
        applyProfile(msg.name, msg.enabled);
        return;
    }

    if (msg.type === "proxyPower") {
        msg.enabled ? enableProxy() : disableProxy();
        return;
    }

    if (msg.type === "getTabProxyState") {
        const tabId = sender.tab && sender.tab.id;
        if (tabId == null) {
            sendResponse({ enabled: false });
            return;
        }

        sendResponse({ enabled: !!(tabProxy[tabId] && tabProxy[tabId].enabled) });
        return true;
    }

    if (msg.type === "toggleTabProxy") {
        const tabId = sender.tab && sender.tab.id;
        if (tabId == null) {
            sendResponse({ enabled: false, reload: false });
            return;
        }

        let host = "";
        try {
            host = new URL(msg.url).hostname.toLowerCase();
        } catch (_) {}

        const current = tabProxy[tabId] && tabProxy[tabId].enabled;

        if (!current) {
            tabProxy[tabId] = { enabled: true };
            addHostForTab(tabId, host);
            refreshPacIfNeeded();
            appendLog("info", "tab_proxy_enabled", { tabId, host });
            sendResponse({ enabled: true, reload: true });
        } else {
            clearTabHosts(tabId);
            refreshPacIfNeeded();
            appendLog("info", "tab_proxy_disabled", { tabId, host });
            sendResponse({ enabled: false, reload: true });
        }

        return true;
    }

    if (msg.type === "getTabErrors") {
        const tabId = typeof msg.tabId === "number" ? msg.tabId : sender.tab && sender.tab.id;
        sendResponse({ errors: getErrorsForTab(tabId) });
        return true;
    }

    if (msg.type === "clearTabErrors") {
        const tabId = typeof msg.tabId === "number" ? msg.tabId : sender.tab && sender.tab.id;
        clearErrorsForTab(tabId);
        sendResponse({ success: true });
        return true;
    }

    if (msg.type === "getHostMonitorState") {
        getHostMonitorState(msg.host).then(sendResponse);
        return true;
    }

    if (msg.type === "addHostToActiveProfileTargets") {
        addHostToActiveProfileTargets(msg.host).then(sendResponse);
        return true;
    }

    if (msg.type === "removeHostFromActiveProfileTargets") {
        removeHostFromActiveProfileTargets(msg.host).then(sendResponse);
        return true;
    }

    if (msg.type === "getLogs") {
        getLogs().then((logs) => sendResponse({ logs }));
        return true;
    }

    if (msg.type === "clearLogs") {
        clearLogs().then(() => sendResponse({ success: true }));
        return true;
    }

    if (msg.type === "setProfileSecret") {
        setProfileSecret(msg.profileName, msg.username, msg.password).then(sendResponse);
        return true;
    }

    if (msg.type === "clearProfileSecret") {
        clearProfileSecret(msg.profileName).then(sendResponse);
        return true;
    }

    if (msg.type === "getProfileSecretState") {
        getProfileSecretState(msg.profileName).then(sendResponse);
        return true;
    }
});

chrome.webRequest.onErrorOccurred.addListener(
    (details) => {
        delete authRequestAttempts[details.requestId];
        addErrorToTab(details.tabId, details.url, details.error);
    },
    { urls: ["<all_urls>"] }
);

chrome.webRequest.onCompleted.addListener(
    (details) => {
        delete authRequestAttempts[details.requestId];

        if (details.statusCode >= 400 && details.statusCode < 600) {
            addErrorToTab(details.tabId, details.url, `HTTP ${details.statusCode}`, details.statusCode);
        }
    },
    { urls: ["<all_urls>"] }
);

chrome.webRequest.onAuthRequired.addListener(
    (details, callback) => {
        if (!details.isProxy) {
            callback({});
            return;
        }

        (async () => {
            const requestKey = String(details.requestId);
            authRequestAttempts[requestKey] = (authRequestAttempts[requestKey] || 0) + 1;

            if (authRequestAttempts[requestKey] > 1) {
                await appendLog("warn", "proxy_auth_retry_blocked", {
                    requestId: details.requestId,
                    challengerHost: details.challenger?.host || "",
                    tabId: details.tabId
                });

                callback({});
                return;
            }

            const { activeProfileName, profile, proxyEnabled } = await getActiveProfileInfo();

            if (!proxyEnabled || !activeProfileName || !profile) {
                callback({});
                return;
            }

            const username = profile.auth?.username || "";
            const secret = await getProfileSecret(activeProfileName);
            const password = secret?.password || "";

            if (!username || !password) {
                await appendLog("warn", "proxy_auth_missing_credentials", {
                    profileName: activeProfileName,
                    challengerHost: details.challenger?.host || "",
                    tabId: details.tabId
                });

                callback({});
                return;
            }

            await appendLog("info", "proxy_auth_credentials_used", {
                profileName: activeProfileName,
                challengerHost: details.challenger?.host || "",
                tabId: details.tabId
            });

            callback({
                authCredentials: {
                    username,
                    password
                }
            });
        })().catch(async (error) => {
            await appendLog("error", "proxy_auth_handler_failed", {
                message: String(error?.message || error)
            });
            callback({});
        });
    },
    { urls: ["<all_urls>"] },
    ["asyncBlocking"]
);

chrome.webNavigation.onCommitted.addListener((details) => {
    if (details.frameId !== 0) {
        return;
    }

    const tabId = details.tabId;
    clearErrorsForTab(tabId);

    if (!tabProxy[tabId] || !tabProxy[tabId].enabled) {
        return;
    }

    let host = "";
    try {
        host = new URL(details.url).hostname.toLowerCase();
    } catch (_) {}

    addHostForTab(tabId, host);
    refreshPacIfNeeded();
});

chrome.tabs.onRemoved.addListener((tabId) => {
    delete errorUrlsByTabId[tabId];

    if (!tabProxy[tabId]) {
        return;
    }

    clearTabHosts(tabId);
    refreshPacIfNeeded();
});

chrome.runtime.onStartup.addListener(async () => {
    const data = await chrome.storage.local.get("proxyEnabled");
    if (data.proxyEnabled) {
        setIconColor([46, 204, 113]);
    } else {
        setIconColor([231, 76, 60]);
    }

    await appendLog("info", "extension_started", {
        proxyEnabled: Boolean(data.proxyEnabled)
    });
});

chrome.runtime.onInstalled.addListener(async () => {
    const data = await chrome.storage.local.get("proxyEnabled");
    if (data.proxyEnabled === undefined) {
        setIconColor([255, 255, 255]);
    }

    await appendLog("info", "extension_installed_or_updated", {
        proxyEnabled: Boolean(data.proxyEnabled)
    });
});