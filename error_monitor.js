const els = {
    pageInfo: document.getElementById("pageInfo"),
    modeChip: document.getElementById("modeChip"),
    stats: document.getElementById("stats"),
    refreshButton: document.getElementById("refreshButton"),
    clearButton: document.getElementById("clearButton"),
    emptyState: document.getElementById("emptyState"),
    errorList: document.getElementById("errorList")
};

const params = new URLSearchParams(window.location.search);

let currentTabId = Number(params.get("tabId"));
const sourceWindowId = Number(params.get("sourceWindowId"));
let currentTitle = params.get("title") || "";
let currentUrl = params.get("sourceUrl") || "";
let autoRefreshTimer = null;

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function formatRelativeTime(timestamp) {
    if (!timestamp) {
        return "только что";
    }

    const diffSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));

    if (diffSec < 60) {
        return `${diffSec} сек назад`;
    }

    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) {
        return `${diffMin} мин назад`;
    }

    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) {
        return `${diffHours} ч назад`;
    }

    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays} дн назад`;
}

function updateHeader() {
    const title = currentTitle || "Без названия";
    const url = currentUrl || "URL не найден";
    els.pageInfo.textContent = `${title} · ${url}`;
}

function updateModeChip(mode) {
    els.modeChip.className = "chip";
    if (mode === "proxy") {
        els.modeChip.classList.add("mode-proxy");
        els.modeChip.textContent = "Режим: адреса проксируются";
        return;
    }

    if (mode === "bypass") {
        els.modeChip.classList.add("mode-bypass");
        els.modeChip.textContent = "Режим: адреса исключаются";
        return;
    }

    els.modeChip.textContent = "Режим: —";
}

async function syncActiveTab() {
    if (!Number.isFinite(sourceWindowId)) {
        return false;
    }

    const tabs = await chrome.tabs.query({
        active: true,
        windowId: sourceWindowId
    });

    const activeTab = tabs[0];
    if (!activeTab || typeof activeTab.id !== "number") {
        return false;
    }

    const changed =
        currentTabId !== activeTab.id ||
        currentUrl !== (activeTab.url || "") ||
        currentTitle !== (activeTab.title || "");

    currentTabId = activeTab.id;
    currentUrl = activeTab.url || "";
    currentTitle = activeTab.title || "";

    return changed;
}

async function getErrors() {
    if (!Number.isFinite(currentTabId)) {
        return [];
    }

    const response = await chrome.runtime.sendMessage({
        type: "getTabErrors",
        tabId: currentTabId
    });

    return Array.isArray(response?.errors) ? response.errors : [];
}

async function getHostState(host) {
    const response = await chrome.runtime.sendMessage({
        type: "getHostMonitorState",
        host
    });

    return response || {
        hasProfile: false,
        mode: "proxy",
        isInTargets: false,
        matchedTargets: [],
        patterns: [],
        actionLabel: "Добавить в адреса",
        removeLabel: "Удалить из адресов"
    };
}

async function addHost(host) {
    return await chrome.runtime.sendMessage({
        type: "addHostToActiveProfileTargets",
        host
    });
}

async function removeHost(host) {
    return await chrome.runtime.sendMessage({
        type: "removeHostFromActiveProfileTargets",
        host
    });
}

function renderStats(errors) {
    const eventCount = errors.reduce((sum, item) => sum + (item.count || 0), 0);
    els.stats.textContent = `${errors.length} хостов · ${eventCount} событий`;
}

async function renderErrors() {
    await syncActiveTab();
    updateHeader();

    const errors = await getErrors();
    renderStats(errors);

    els.errorList.innerHTML = "";

    if (!errors.length) {
        els.emptyState.style.display = "block";
        updateModeChip(null);
        return;
    }

    els.emptyState.style.display = "none";

    let lastKnownMode = null;

    for (const error of errors) {
        const state = await getHostState(error.host);
        lastKnownMode = state.mode || lastKnownMode;

        const item = document.createElement("div");
        item.className = "item";

        const matchedInfo = state.isInTargets
            ? `Уже есть в адресах: ${state.matchedTargets.join(", ")}`
            : `Будет добавлено в адреса: ${state.patterns.join(", ")}`;

        item.innerHTML = `
            <div class="row">
                <div class="host">${escapeHtml(error.host)}</div>
                <div class="badge">${escapeHtml(String(error.count || 1))}</div>
            </div>

            <div class="row">
                <div class="error-text">${escapeHtml(error.errorMessage || "Ошибка")}</div>
            </div>

            <div class="row">
                <div class="state">${escapeHtml(matchedInfo)}</div>
            </div>

            <div class="row">
                <div class="muted">${escapeHtml(error.lastUrl || "")}</div>
            </div>

            <div class="row">
                <div class="muted">Последняя ошибка: ${escapeHtml(formatRelativeTime(error.lastSeen))}</div>
            </div>

            <div class="actions">
                <button class="button button-primary action-main">
                    ${escapeHtml(state.isInTargets ? state.removeLabel : state.actionLabel)}
                </button>
            </div>
        `;

        const actionButton = item.querySelector(".action-main");

        actionButton.addEventListener("click", async () => {
            actionButton.disabled = true;

            const response = state.isInTargets
                ? await removeHost(error.host)
                : await addHost(error.host);

            if (!response?.success) {
                actionButton.disabled = false;
                return;
            }

            await renderErrors();
        });

        els.errorList.appendChild(item);
    }

    updateModeChip(lastKnownMode);
}

async function clearErrors() {
    if (!Number.isFinite(currentTabId)) {
        return;
    }

    await chrome.runtime.sendMessage({
        type: "clearTabErrors",
        tabId: currentTabId
    });

    await renderErrors();
}

function startAutoTracking() {
    if (autoRefreshTimer) {
        clearInterval(autoRefreshTimer);
    }

    autoRefreshTimer = setInterval(async () => {
        const changed = await syncActiveTab();
        if (changed) {
            await renderErrors();
        }
    }, 1000);
}

document.addEventListener("DOMContentLoaded", async () => {
    updateHeader();
    await renderErrors();
    startAutoTracking();

    els.refreshButton.addEventListener("click", async () => {
        await renderErrors();
    });

    els.clearButton.addEventListener("click", async () => {
        await clearErrors();
    });
});

window.addEventListener("beforeunload", () => {
    if (autoRefreshTimer) {
        clearInterval(autoRefreshTimer);
    }
});