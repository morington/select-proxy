const els = {
    logMeta: document.getElementById("logMeta"),
    refreshButton: document.getElementById("refreshButton"),
    exportButton: document.getElementById("exportButton"),
    clearButton: document.getElementById("clearButton"),
    emptyState: document.getElementById("emptyState"),
    logList: document.getElementById("logList")
};

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

async function fetchLogs() {
    const response = await chrome.runtime.sendMessage({
        type: "getLogs"
    });

    return Array.isArray(response?.logs) ? response.logs : [];
}

function renderMeta(logs) {
    els.logMeta.textContent = `${logs.length} записей`;
}

function formatJson(value) {
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

async function renderLogs() {
    const logs = await fetchLogs();
    renderMeta(logs);

    els.logList.innerHTML = "";

    if (!logs.length) {
        els.emptyState.style.display = "block";
        return;
    }

    els.emptyState.style.display = "none";

    for (const log of [...logs].reverse()) {
        const entry = document.createElement("div");
        entry.className = "entry";

        const level = escapeHtml(log.level || "info");
        const event = escapeHtml(log.event || "unknown");
        const ts = escapeHtml(log.ts || "");
        const details = escapeHtml(formatJson(log.details || {}));

        entry.innerHTML = `
            <div class="entry-top">
                <div class="badge ${level}">${level.toUpperCase()}</div>
                <div class="event">${event}</div>
                <div class="ts">${ts}</div>
            </div>
            <pre>${details}</pre>
        `;

        els.logList.appendChild(entry);
    }
}

async function exportLogs() {
    const logs = await fetchLogs();
    const payload = {
        exportedAt: new Date().toISOString(),
        source: "select-proxy",
        issueUrl: "https://github.com/morington/select-proxy",
        logs
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json"
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "select_proxy_logs.json";
    link.click();
    URL.revokeObjectURL(url);
}

async function clearLogs() {
    await chrome.runtime.sendMessage({
        type: "clearLogs"
    });

    await renderLogs();
}

document.addEventListener("DOMContentLoaded", async () => {
    await renderLogs();

    els.refreshButton.addEventListener("click", async () => {
        await renderLogs();
    });

    els.exportButton.addEventListener("click", async () => {
        await exportLogs();
    });

    els.clearButton.addEventListener("click", async () => {
        await clearLogs();
    });
});