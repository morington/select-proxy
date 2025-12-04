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

function pacProxyOnly(listStr, proxyStr) {
    return `
    function FindProxyForURL(url, host) {
        var t=${listStr};
        function m(x){if(x.startsWith("*."))return dnsDomainIs(host,x.substring(1));return host===x;}
        for(var i=0;i<t.length;i++)if(m(t[i]))return "${proxyStr}";
        return "DIRECT";
    }`;
}

function pacBypass(listStr, proxyStr) {
    return `
    function FindProxyForURL(url, host) {
        var b=${listStr};
        function m(x){if(x.startsWith("*."))return dnsDomainIs(host,x.substring(1));return host===x;}
        for(var i=0;i<b.length;i++)if(m(b[i]))return "DIRECT";
        return "${proxyStr}";
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
    const pac = pr.mode === "proxy" ? pacProxyOnly(listStr, proxyStr) : pacBypass(listStr, proxyStr);

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

chrome.runtime.onMessage.addListener(msg => {
    if (msg.type === "applyProfile") applyProfile(msg.name, msg.enabled);
    if (msg.type === "proxyPower") msg.enabled ? enableProxy() : disableProxy();
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
