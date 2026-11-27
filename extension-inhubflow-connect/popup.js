(function () {
  let cachedLiAt = null;
  let cachedLiA = null;
  let lastDiagnosticInfo = {};

  function safeGetCookie(url, name, partitionKey) {
    return new Promise((resolve) => {
      try {
        if (!chrome.cookies || !chrome.cookies.get) {
          resolve(null);
          return;
        }
        const details = { url, name };
        if (partitionKey) details.partitionKey = partitionKey;
        chrome.cookies.get(details, (cookie) => {
          if (chrome.runtime.lastError) {
            resolve(null);
          } else {
            resolve(cookie || null);
          }
        });
      } catch {
        resolve(null);
      }
    });
  }

  function safeGetAllCookies(details) {
    return new Promise((resolve) => {
      try {
        if (!chrome.cookies || !chrome.cookies.getAll) {
          resolve([]);
          return;
        }
        chrome.cookies.getAll(details, (cookies) => {
          if (chrome.runtime.lastError) {
            resolve([]);
          } else {
            resolve(cookies || []);
          }
        });
      } catch {
        resolve([]);
      }
    });
  }

  // Detección directa ultrarrápida y canónica
  async function queryLinkedInCookies() {
    const result = { liAt: null, liA: null, source: null, diagnostics: [] };

    // Estrategia 1: Consulta directa en URLs oficiales (El estándar de extensiones de LinkedIn)
    const canonicalUrls = [
      "https://www.linkedin.com",
      "https://linkedin.com",
      "https://www.linkedin.com/",
      "https://linkedin.com/",
      "https://www.linkedin.com/feed",
      "https://linkedin.com/feed",
    ];

    for (const u of canonicalUrls) {
      const cAt = await safeGetCookie(u, "li_at");
      if (cAt && cAt.value) {
        result.liAt = cAt.value;
        const cA = await safeGetCookie(u, "li_a");
        if (cA && cA.value) result.liA = cA.value;
        result.source = `directUrl:${u}`;
        result.diagnostics.push(`Éxito en ${u}`);
        return result;
      } else {
        result.diagnostics.push(`No encontrado en ${u}`);
      }
    }

    // Estrategia 2: Consulta por dominio limpio sin puntos
    const domains = ["linkedin.com", "www.linkedin.com"];
    for (const d of domains) {
      const cookies = await safeGetAllCookies({ domain: d });
      result.diagnostics.push(`Dominio ${d}: ${cookies.length} cookies encontradas`);
      for (const c of cookies) {
        if (c.name === "li_at" && c.value && !result.liAt) result.liAt = c.value;
        if (c.name === "li_a" && c.value && !result.liA) result.liA = c.value;
      }
      if (result.liAt) {
        result.source = `domain:${d}`;
        return result;
      }
    }

    // Estrategia 3: Pestaña activa en la ventana activa (lastFocusedWindow)
    try {
      const tabs = await new Promise((r) =>
        chrome.tabs.query({ active: true, lastFocusedWindow: true }, (t) => r(t || []))
      );
      if (tabs && tabs[0] && tabs[0].url) {
        result.diagnostics.push(`Pestaña activa: ${tabs[0].url}`);
        if (tabs[0].url.includes("linkedin.com")) {
          const origin = new URL(tabs[0].url).origin;
          const cAt = await safeGetCookie(origin, "li_at");
          if (cAt && cAt.value) {
            result.liAt = cAt.value;
            const cA = await safeGetCookie(origin, "li_a");
            if (cA && cA.value) result.liA = cA.value;
            result.source = `activeTab:${origin}`;
            return result;
          }
        }
      }
    } catch (e) {
      result.diagnostics.push(`Error consultando tabs: ${e.message}`);
    }

    // Estrategia 4: Consulta con soporte para CHIPS (Cookies particionadas en Chrome reciente)
    for (const u of ["https://www.linkedin.com", "https://linkedin.com"]) {
      const cAt = await safeGetCookie(u, "li_at", {});
      if (cAt && cAt.value) {
        result.liAt = cAt.value;
        const cA = await safeGetCookie(u, "li_a", {});
        if (cA && cA.value) result.liA = cA.value;
        result.source = `partitioned:${u}`;
        return result;
      }
    }

    // Estrategia 5: Fallback al Background Service Worker
    try {
      if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
        const bgResult = await new Promise((resolve) => {
          const timer = setTimeout(() => resolve(null), 1200);
          try {
            chrome.runtime.sendMessage({ type: "GET_LINKEDIN_COOKIES" }, (res) => {
              clearTimeout(timer);
              if (chrome.runtime.lastError) {
                resolve(null);
                return;
              }
              resolve(res || null);
            });
          } catch {
            clearTimeout(timer);
            resolve(null);
          }
        });
        if (bgResult && bgResult.liAt) {
          result.liAt = bgResult.liAt;
          result.liA = bgResult.liA;
          result.source = "backgroundWorker";
          return result;
        }
      }
    } catch (e) {
      result.diagnostics.push(`Error en background: ${e.message}`);
    }

    return result;
  }

  function showFeedback(msg, type = "info") {
    const box = document.getElementById("feedback-box");
    const text = document.getElementById("feedback-text");
    if (!box || !text) return;

    box.className = `feedback-box ${type}`;
    text.textContent = msg;
    box.classList.remove("hidden");
  }

  async function findInHubFlowTabs() {
    if (typeof chrome === "undefined" || !chrome.tabs) return [];
    try {
      const tabs = await chrome.tabs.query({
        url: [
          "http://localhost/*",
          "http://127.0.0.1/*",
          "https://*.inhubflow.com/*",
          "https://inhubflow.com/*",
          "https://*.inhubflow.online/*",
          "https://inhubflow.online/*",
        ],
      });
      return tabs || [];
    } catch {
      return [];
    }
  }

  function focusInHubFlowTab(targetTab) {
    if (!targetTab || typeof chrome === "undefined" || !chrome.tabs) return;
    try {
      chrome.tabs.update(targetTab.id, { active: true });
      if (targetTab.windowId && chrome.windows) {
        chrome.windows.update(targetTab.windowId, { focused: true });
      }
    } catch {}
  }

  async function handleAutoConnect() {
    const btn = document.getElementById("btn-autoconnect");
    const btnSpinner = document.getElementById("btn-spinner");
    const btnBolt = document.getElementById("btn-bolt");
    const btnText = document.getElementById("btn-autoconnect-text");

    if (!cachedLiAt) {
      showFeedback("No se detectó la cookie de sesión de LinkedIn.", "error");
      return;
    }

    // 1. Copiar token de inmediato al portapapeles del sistema
    try {
      await navigator.clipboard.writeText(cachedLiAt);
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = cachedLiAt;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {}
    }

    btn.classList.add("connecting");
    btn.disabled = true;
    if (btnSpinner) btnSpinner.classList.remove("hidden");
    if (btnBolt) btnBolt.classList.add("hidden");
    if (btnText) btnText.textContent = "Conectando con InHubFlow...";
    showFeedback("Vinculando tu sesión con InHubFlow...", "info");

    try {
      const tabs = await findInHubFlowTabs();

      if (tabs.length > 0) {
        const targetTab = tabs[0];

        // 2. Enviar mensaje por chrome.tabs.sendMessage y esperar respuesta del Dashboard si está en /linkedin-accounts
        const tabResponsePromise = new Promise((resolve) => {
          const timer = setTimeout(() => resolve(null), 5000);
          try {
            chrome.tabs.sendMessage(
              targetTab.id,
              {
                type: "INHUBFLOW_AUTOCONNECT",
                accessToken: cachedLiAt,
                premiumToken: cachedLiA || null,
                userAgent: navigator.userAgent,
              },
              (res) => {
                clearTimeout(timer);
                if (chrome.runtime.lastError) {
                  resolve(null);
                  return;
                }
                resolve(res || null);
              }
            );
          } catch {
            clearTimeout(timer);
            resolve(null);
          }
        });

        // 3. Inyectar script directo para garantizar paso de token por sessionStorage, CustomEvent y postMessage
        if (typeof chrome !== "undefined" && chrome.scripting && chrome.scripting.executeScript) {
          try {
            await chrome.scripting.executeScript({
              target: { tabId: targetTab.id },
              func: (token, premToken, ua) => {
                try {
                  sessionStorage.setItem("inhubflow_autoconnect_token", token);
                  if (premToken) sessionStorage.setItem("inhubflow_autoconnect_prema", premToken);
                  const p = { accessToken: token, premiumToken: premToken, userAgent: ua, source: "INHUBFLOW_EXTENSION" };
                  try { document.dispatchEvent(new CustomEvent("INHUBFLOW_AUTOCONNECT_EVENT", { detail: p })); } catch {}
                  try { window.dispatchEvent(new CustomEvent("INHUBFLOW_AUTOCONNECT_EVENT", { detail: p })); } catch {}
                  window.postMessage({ source: "INHUBFLOW_EXTENSION", type: "AUTOCONNECT", ...p }, "*");
                } catch (e) {
                  console.warn("[InHubFlow Connect] script injection error:", e);
                }
              },
              args: [cachedLiAt, cachedLiA || null, navigator.userAgent],
            });
          } catch (e) {
            console.warn("[popup] Error en scripting.executeScript:", e);
          }
        }

        const tabRes = await tabResponsePromise;
        if (tabRes && (tabRes.success || tabRes.checkpoint || tabRes.error)) {
          btn.classList.remove("connecting");
          if (btnSpinner) btnSpinner.classList.add("hidden");
          if (tabRes.success) {
            btn.classList.add("connected-success");
            if (btnText) btnText.textContent = "✓ ¡Conectado con Éxito!";
            showFeedback("¡Tu cuenta de LinkedIn quedó conectada a InHubFlow!", "success");
            focusInHubFlowTab(targetTab);
          } else if (tabRes.checkpoint) {
            if (btnText) btnText.textContent = "Verificación 2FA Requerida";
            showFeedback("LinkedIn solicita código de seguridad. Abre InHubFlow para ingresarlo.", "info");
            btn.disabled = false;
            focusInHubFlowTab(targetTab);
          } else {
            if (btnBolt) btnBolt.classList.remove("hidden");
            if (btnText) btnText.textContent = "⚡ Reintentar Conexión";
            showFeedback(tabRes.error || "No se pudo conectar con InHubFlow.", "error");
            btn.disabled = false;
          }
          return;
        }

        // 4. Fallback API directo antes de cambiar el foco (para no cerrar el popup antes del fetch)
        await executeDirectApiFallback(targetTab.url || "http://localhost:3002");
        focusInHubFlowTab(targetTab);
      } else {
        await executeDirectApiFallback("http://localhost:3002");
        if (typeof chrome !== "undefined" && chrome.tabs) {
          chrome.tabs.create({ url: "http://localhost:3002/linkedin-accounts" });
        }
      }
    } catch (err) {
      btn.classList.remove("connecting");
      btn.disabled = false;
      if (btnSpinner) btnSpinner.classList.add("hidden");
      if (btnBolt) btnBolt.classList.remove("hidden");
      if (btnText) btnText.textContent = "⚡ Conectar LinkedIn con InHub";
      showFeedback(err instanceof Error ? err.message : "Error al conectar.", "error");
    }
  }

  async function executeDirectApiFallback(baseUrl) {
    const btn = document.getElementById("btn-autoconnect");
    const btnSpinner = document.getElementById("btn-spinner");
    const btnBolt = document.getElementById("btn-bolt");
    const btnText = document.getElementById("btn-autoconnect-text");

    let origin = "http://localhost:3002";
    try {
      origin = new URL(baseUrl).origin;
    } catch {
      origin = "http://localhost:3002";
    }

    try {
      const res = await fetch(`${origin}/api/unipile/auth-native`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "cookie",
          accessToken: cachedLiAt,
          premiumToken: cachedLiA || undefined,
          userAgent: navigator.userAgent,
        }),
      });

      const data = await res.json();
      btn.classList.remove("connecting");
      if (btnSpinner) btnSpinner.classList.add("hidden");

      if (res.ok && !data.checkpoint) {
        btn.classList.add("connected-success");
        if (btnText) btnText.textContent = "✓ ¡Conectado con Éxito!";
        showFeedback("¡Tu cuenta de LinkedIn quedó conectada a InHubFlow!", "success");

        if (typeof chrome !== "undefined" && chrome.tabs) {
          const tabs = await findInHubFlowTabs();
          if (tabs.length === 0) {
            chrome.tabs.create({ url: `${origin}/linkedin-accounts` });
          }
        }
      } else if (data.checkpoint) {
        if (btnText) btnText.textContent = "Verificación 2FA Requerida";
        showFeedback("LinkedIn solicita código de seguridad. Abre InHubFlow para ingresarlo.", "info");
        btn.disabled = false;
      } else {
        if (btnBolt) btnBolt.classList.remove("hidden");
        if (btnText) btnText.textContent = "⚡ Reintentar Conexión";
        showFeedback(data.error || "No se pudo conectar con InHubFlow.", "error");
        btn.disabled = false;
      }
    } catch (err) {
      btn.classList.remove("connecting");
      btn.disabled = false;
      if (btnSpinner) btnSpinner.classList.add("hidden");
      if (btnBolt) btnBolt.classList.remove("hidden");
      if (btnText) btnText.textContent = "⚡ Conectar LinkedIn con InHub";
      showFeedback("Error comunicando con el servidor de InHubFlow.", "error");
    }
  }

  async function checkAndRenderSession() {
    const stateLoading = document.getElementById("state-loading");
    const stateDetected = document.getElementById("state-detected");
    const stateEmpty = document.getElementById("state-empty");
    const cookiePreview = document.getElementById("cookie-preview");
    const salesNavRow = document.getElementById("sales-nav-row");
    const btnAutoConnect = document.getElementById("btn-autoconnect");
    const btnCopy = document.getElementById("btn-copy");
    const btnCopyText = document.getElementById("btn-copy-text");
    const diagBox = document.getElementById("diag-content");

    if (stateLoading) stateLoading.classList.remove("hidden");
    if (stateDetected) stateDetected.classList.add("hidden");
    if (stateEmpty) stateEmpty.classList.add("hidden");

    const queryRes = await queryLinkedInCookies();
    const { liAt, liA } = queryRes;
    cachedLiAt = liAt;
    cachedLiA = liA;
    lastDiagnosticInfo = queryRes;

    if (diagBox) {
      const escapeHtml = (s) =>
        String(s)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
      diagBox.innerHTML = `
        <div style="font-size: 10px; line-height: 1.4; color: #475467; background: #F2F4F7; padding: 6px; border-radius: 4px; border: 1px solid #D0D5DD; max-height: 100px; overflow-y: auto; text-align: left;">
          <strong>Origen:</strong> ${escapeHtml(queryRes.source || "Ninguno")}<br/>
          <strong>li_at:</strong> ${liAt ? `Encontrado (${liAt.length} caracteres)` : "No detectado"}<br/>
          ${(queryRes.diagnostics || []).map(d => `• ${escapeHtml(d)}`).join("<br/>")}
        </div>
      `;
    }

    if (stateLoading) stateLoading.classList.add("hidden");

    if (liAt) {
      if (stateDetected) stateDetected.classList.remove("hidden");

      if (cookiePreview) {
        const prefix = liAt.slice(0, 6);
        cookiePreview.textContent = `${prefix}•••••• (${liAt.length} chars)`;
      }

      if (liA && salesNavRow) {
        salesNavRow.style.display = "flex";
      }

      if (btnAutoConnect && !btnAutoConnect._hasClick) {
        btnAutoConnect._hasClick = true;
        btnAutoConnect.addEventListener("click", handleAutoConnect);
      }

      if (btnCopy && !btnCopy._hasClick) {
        btnCopy._hasClick = true;
        btnCopy.addEventListener("click", async () => {
          try {
            await navigator.clipboard.writeText(liAt);
            btnCopy.classList.add("copied");
            if (btnCopyText) btnCopyText.textContent = "¡Código Copiado! 🎉";

            setTimeout(() => {
              btnCopy.classList.remove("copied");
              if (btnCopyText) btnCopyText.textContent = "Copiar Código Manualmente";
            }, 3000);
          } catch (err) {
            const ta = document.createElement("textarea");
            ta.value = liAt;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            document.body.removeChild(ta);
            btnCopy.classList.add("copied");
            if (btnCopyText) btnCopyText.textContent = "¡Código Copiado! 🎉";
            setTimeout(() => {
              btnCopy.classList.remove("copied");
              if (btnCopyText) btnCopyText.textContent = "Copiar Código Manualmente";
            }, 3000);
          }
        });
      }
    } else {
      if (stateEmpty) stateEmpty.classList.remove("hidden");
    }
  }

  function init() {
    const btnOpenLinkedIn = document.getElementById("btn-open-linkedin");
    const btnRetry = document.getElementById("btn-retry");
    const diagToggle = document.getElementById("diag-toggle");
    const diagContainer = document.getElementById("diag-container");

    if (btnRetry) {
      btnRetry.addEventListener("click", () => {
        checkAndRenderSession();
      });
    }

    if (diagToggle && diagContainer) {
      diagToggle.addEventListener("click", () => {
        diagContainer.classList.toggle("hidden");
      });
    }

    if (btnOpenLinkedIn) {
      btnOpenLinkedIn.addEventListener("click", () => {
        if (typeof chrome !== "undefined" && chrome.tabs) {
          chrome.tabs.create({ url: "https://www.linkedin.com/feed/" });
        } else {
          window.open("https://www.linkedin.com/feed/", "_blank");
        }
      });
    }

    checkAndRenderSession();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
