let btn = null;
let currentState = false;

function createButton() {
    if (btn) return;

    btn = document.createElement("img");
    btn.src = chrome.runtime.getURL("icons/24.png");
    btn.id = "select-proxy-tab-toggle";

    btn.style.position = "fixed";
    btn.style.bottom = "16px";
    btn.style.left = "16px";
    btn.style.width = "28px";
    btn.style.height = "28px";
    btn.style.padding = "6px";
    btn.style.borderRadius = "50%";
    btn.style.background = "rgba(40,40,48,0.6)";
    btn.style.boxShadow = "0 0 6px rgba(0,0,0,0.4)";
    btn.style.cursor = "pointer";
    btn.style.zIndex = "2147483647";
    btn.style.userSelect = "none";
    btn.style.backdropFilter = "blur(4px)";
    btn.style.transition = "background 0.15s, opacity 0.15s, box-shadow 0.15s";
    btn.style.opacity = "0.55";

    btn.addEventListener("click", () => {
        chrome.runtime.sendMessage(
            { type: "toggleTabProxy", url: location.href },
            resp => {
                if (!resp) return;
                setState(resp.enabled);
                if (resp.reload) location.reload();
            }
        );
    });

    document.body.appendChild(btn);
    requestInitialState();
}

function removeButton() {
    if (!btn) return;
    btn.remove();
    btn = null;
}

function setState(on) {
    currentState = on;

    if (!btn) return;

    if (on) {
        btn.style.background = "#2ecc71";
        btn.style.opacity = "1";
        btn.style.boxShadow = "0 0 10px rgba(46,204,113,0.6)";
    } else {
        btn.style.background = "rgba(40,40,48,0.6)";
        btn.style.opacity = "0.55";
        btn.style.boxShadow = "0 0 6px rgba(0,0,0,0.4)";
    }
}

function requestInitialState() {
    chrome.runtime.sendMessage({ type: "getTabProxyState" }, resp => {
        if (resp && typeof resp.enabled === "boolean") {
            setState(resp.enabled);
        }
    });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "updateFastProxyVisibility") {
        if (msg.visible) createButton();
        else removeButton();
    }
});

chrome.storage.onChanged.addListener(changes => {
    if (changes.showTabProxy) {
        const v = changes.showTabProxy.newValue;
        if (v) createButton();
        else removeButton();
    }
});

chrome.storage.local.get("showTabProxy", d => {
    if (d.showTabProxy === false) return;
    if (document.body) createButton();
});
