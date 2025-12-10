const tabProxy = {};
const tabHosts = {};
const hostRefs = {};

async function loadImage(path) {
    const url = chrome.runtime.getURL(path);
    const r = await fetch(url);
    const blob = await r.blob();
    return await createImageBitmap(blob);
}

async function createIconWithBackground(size, rgb) {
    const bmp = await loadImage(`icons/${size}.png`);
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.drawImage(bmp, 0, 0, size, size);
    return ctx.getImageData(0, 0, size, size);
}

async function setIconColor(rgb) {
    const sizes = [24, 32, 48, 64];
    const result = {};
    for (const s of sizes) result[s] = await createIconWithBackground(s, rgb);
    chrome.action.setIcon({ imageData: result });
}

function formatEntry(type, host, port) {
    if (!host || !port) return null;
    if (type === "socks5") return `SOCKS5 ${host}:${port}`;
    if (type === "socks4") return `SOCKS4 ${host}:${port}`;
    if (type === "http") return `PROXY ${host}:${port}`;
    if (type === "https") return `HTTPS ${host}:${port}`;
    return null;
}

function buildProxyString(scheme, http, ssl, ftp) {
    const a = [];
    const h = formatEntry(scheme, http.host, http.port);
    if (h) a.push(h);
    const s = formatEntry(scheme, ssl.host, ssl.port);
    if (s) a.push(s);
    const f = formatEntry(scheme, ftp.host, ftp.port);
    if (f) a.push(f);
    return a.join("; ");
}

function buildPac(mode, listStr, proxyStr, overrideStr) {
    return `
function FindProxyForURL(url, host) {
  var override=${overrideStr};
  function match(list,h){
    for(var i=0;i<list.length;i++){
      var t=list[i];
      if(t.indexOf("*.")===0){
        if(dnsDomainIs(h,t.substring(1)))return true;
      }else if(h===t){
        return true;
      }
    }
    return false;
  }
  if(match(override,host))return "${proxyStr}";
  var targets=${listStr};
  if("${mode}"==="proxy"){
    if(match(targets,host))return "${proxyStr}";
    return "DIRECT";
  }else{
    if(match(targets,host))return "DIRECT";
    return "${proxyStr}";
  }
}`;
}

function getProfile(name) {
    return new Promise(r => {
        chrome.storage.local.get("profile:" + name, d => r(d["profile:" + name] || null));
    });
}

async function applyProfile(name, enabled) {
    if (!enabled) {
        disableProxy();
        return;
    }
    const pr = await getProfile(name);
    if (!pr) {
        disableProxy();
        return;
    }

    const listStr = JSON.stringify(pr.targets || []);
    const proxyStr = buildProxyString(pr.scheme, pr.http, pr.ssl, pr.ftp);
    const overrideHosts = Object.keys(hostRefs).filter(h => hostRefs[h] > 0);
    const overrideStr = JSON.stringify(overrideHosts);
    const pac = buildPac(pr.mode, listStr, proxyStr, overrideStr);

    chrome.proxy.settings.set(
        {
            value: { mode: "pac_script", pacScript: { data: pac } },
            scope: "regular"
        },
        () => {}
    );

    setIconColor([46, 204, 113]);
}

async function enableProxy() {
    const d = await chrome.storage.local.get("activeProfile");
    if (!d.activeProfile) return;
    setIconColor([46, 204, 113]);
    applyProfile(d.activeProfile, true);
}

function disableProxy() {
    chrome.proxy.settings.clear({ scope: "regular" });
    setIconColor([231, 76, 60]);
}

function addHostForTab(tabId, host) {
    if (!host) return;
    if (!tabHosts[tabId]) tabHosts[tabId] = new Set();
    if (!tabHosts[tabId].has(host)) {
        tabHosts[tabId].add(host);
        hostRefs[host] = (hostRefs[host] || 0) + 1;
    }
}

function clearTabHosts(tabId) {
    const set = tabHosts[tabId];
    if (!set) return;
    for (const h of set) {
        hostRefs[h] = (hostRefs[h] || 0) - 1;
        if (hostRefs[h] <= 0) delete hostRefs[h];
    }
    delete tabHosts[tabId];
    delete tabProxy[tabId];
}

async function refreshPacIfNeeded() {
    const d = await chrome.storage.local.get(["activeProfile", "proxyEnabled"]);
    if (!d.proxyEnabled || !d.activeProfile) return;
    applyProfile(d.activeProfile, true);
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

        const url = msg.url;
        let host = "";
        try {
            host = new URL(url).hostname;
        } catch (_) {}

        const current = tabProxy[tabId] && tabProxy[tabId].enabled;

        if (!current) {
            tabProxy[tabId] = { enabled: true };
            addHostForTab(tabId, host);
            refreshPacIfNeeded();
            sendResponse({ enabled: true, reload: true });
        } else {
            clearTabHosts(tabId);
            refreshPacIfNeeded();
            sendResponse({ enabled: false, reload: true });
        }

        return true;
    }
});

chrome.webNavigation.onCommitted.addListener(details => {
    if (details.frameId !== 0) return;
    const tabId = details.tabId;
    if (!tabProxy[tabId] || !tabProxy[tabId].enabled) return;

    let host = "";
    try {
        host = new URL(details.url).hostname;
    } catch (_) {}

    addHostForTab(tabId, host);
    refreshPacIfNeeded();
});

chrome.tabs.onRemoved.addListener(tabId => {
    if (!tabProxy[tabId]) return;
    clearTabHosts(tabId);
    refreshPacIfNeeded();
});

chrome.runtime.onStartup.addListener(async () => {
    const d = await chrome.storage.local.get("proxyEnabled");
    if (d.proxyEnabled) setIconColor([46, 204, 113]);
    else setIconColor([231, 76, 60]);
});

chrome.runtime.onInstalled.addListener(async () => {
    const d = await chrome.storage.local.get("proxyEnabled");
    if (d.proxyEnabled === undefined) setIconColor([255, 255, 255]);
});
