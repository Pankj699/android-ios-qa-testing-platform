import { DEFAULT_GEMINI_MODEL, STORAGE_KEYS } from "./constants.js";

function isBrowser() {
  return typeof window !== "undefined";
}

function read(key, fallback) {
  if (!isBrowser()) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error("Failed to write to localStorage:", e);
  }
}

/**
 * Non-destructive migration: if user does not have scoped settings/history/ai,
 * check if there are legacy keys (e.g. from standalone BugDesk or previous session)
 * and migrate them into the user's scoped keys.
 */
function migrateLegacyData(userId) {
  if (!isBrowser() || !userId) return;

  try {
    // 1. Settings migration
    const userSettingsKey = STORAGE_KEYS.scoped(userId, "settings");
    if (!window.localStorage.getItem(userSettingsKey)) {
      // Check legacy session in qabr:session
      let legacySettings = null;
      try {
        const rawLegacySession = window.localStorage.getItem(STORAGE_KEYS.session);
        if (rawLegacySession) {
          const oldSession = JSON.parse(rawLegacySession);
          if (oldSession?.userId && oldSession.userId !== userId) {
            const oldKey = STORAGE_KEYS.scoped(oldSession.userId, "settings");
            const oldRaw = window.localStorage.getItem(oldKey);
            if (oldRaw) legacySettings = JSON.parse(oldRaw);
          }
        }
      } catch {}

      if (!legacySettings) {
        const unscopedRaw = window.localStorage.getItem("qabr:settings") || window.localStorage.getItem("bugdesk:settings");
        if (unscopedRaw) {
          try { legacySettings = JSON.parse(unscopedRaw); } catch {}
        }
      }

      if (legacySettings) {
        write(userSettingsKey, legacySettings);
      }
    }

    // 2. AI Settings migration
    const userAiKey = STORAGE_KEYS.scoped(userId, "ai-settings");
    if (!window.localStorage.getItem(userAiKey)) {
      let legacyAi = null;
      try {
        const rawLegacySession = window.localStorage.getItem(STORAGE_KEYS.session);
        if (rawLegacySession) {
          const oldSession = JSON.parse(rawLegacySession);
          if (oldSession?.userId && oldSession.userId !== userId) {
            const oldKey = STORAGE_KEYS.scoped(oldSession.userId, "ai-settings");
            const oldRaw = window.localStorage.getItem(oldKey);
            if (oldRaw) legacyAi = JSON.parse(oldRaw);
          }
        }
      } catch {}

      if (!legacyAi) {
        const unscopedRaw = window.localStorage.getItem("qabr:ai-settings") || window.localStorage.getItem("bugdesk:ai-settings");
        if (unscopedRaw) {
          try { legacyAi = JSON.parse(unscopedRaw); } catch {}
        }
      }

      if (legacyAi) {
        write(userAiKey, legacyAi);
      }
    }

    // 3. History migration
    const userHistoryKey = STORAGE_KEYS.scoped(userId, "history");
    if (!window.localStorage.getItem(userHistoryKey)) {
      let legacyHistory = null;
      try {
        const rawLegacySession = window.localStorage.getItem(STORAGE_KEYS.session);
        if (rawLegacySession) {
          const oldSession = JSON.parse(rawLegacySession);
          if (oldSession?.userId && oldSession.userId !== userId) {
            const oldKey = STORAGE_KEYS.scoped(oldSession.userId, "history");
            const oldRaw = window.localStorage.getItem(oldKey);
            if (oldRaw) legacyHistory = JSON.parse(oldRaw);
          }
        }
      } catch {}

      if (!legacyHistory) {
        const unscopedRaw = window.localStorage.getItem("qabr:history") || window.localStorage.getItem("bugdesk:history");
        if (unscopedRaw) {
          try { legacyHistory = JSON.parse(unscopedRaw); } catch {}
        }
      }

      if (legacyHistory && Array.isArray(legacyHistory)) {
        write(userHistoryKey, legacyHistory);
      }
    }

    // 4. Selected Platform migration (one-time claim to ensure it never leaks to other users)
    const userPlatformKey = STORAGE_KEYS.scoped(userId, "selected-platform");
    if (!window.localStorage.getItem(userPlatformKey)) {
      const unscopedKey = "qabr:selected-platform";
      const legacyRaw = window.localStorage.getItem(unscopedKey) || window.localStorage.getItem("bugdesk:selected-platform");
      if (legacyRaw) {
        try {
          const parsed = JSON.parse(legacyRaw);
          if (parsed === "android" || parsed === "ios") {
            write(userPlatformKey, parsed);
            try {
              window.localStorage.removeItem(unscopedKey);
              window.localStorage.removeItem("bugdesk:selected-platform");
            } catch {}
          }
        } catch {}
      }
    }
  } catch (err) {
    console.warn("BugDesk legacy migration skipped:", err);
  }
}

// ---- Module / project settings (first-time setup) ----

export function getModuleSettings(userId) {
  if (!userId) return null;
  migrateLegacyData(userId);
  return read(STORAGE_KEYS.scoped(userId, "settings"), null);
}

export function saveModuleSettings(userId, settings) {
  if (!userId) return;
  write(STORAGE_KEYS.scoped(userId, "settings"), settings);
}

// ---- AI settings (Gemini API key + model) ----

export function getAISettings(userId) {
  if (!userId) return { apiKey: "", model: DEFAULT_GEMINI_MODEL };
  migrateLegacyData(userId);
  return read(STORAGE_KEYS.scoped(userId, "ai-settings"), {
    apiKey: "",
    model: DEFAULT_GEMINI_MODEL,
  });
}

export function saveAISettings(userId, settings) {
  if (!userId) return;
  write(STORAGE_KEYS.scoped(userId, "ai-settings"), settings);
  if (isBrowser()) {
    try {
      window.dispatchEvent(new CustomEvent("bugdesk:ai-settings-updated", { detail: settings }));
    } catch {}
  }
}

// ---- Bug report history ----

export function getBugHistory(userId) {
  if (!userId) return [];
  migrateLegacyData(userId);
  return read(STORAGE_KEYS.scoped(userId, "history"), []);
}

export function saveBugReport(userId, report) {
  if (!userId) return;
  const history = getBugHistory(userId);
  write(STORAGE_KEYS.scoped(userId, "history"), [report, ...history]);
}

export function deleteBugReport(userId, reportId) {
  if (!userId) return;
  const history = getBugHistory(userId);
  write(
    STORAGE_KEYS.scoped(userId, "history"),
    history.filter((r) => r.id !== reportId)
  );
}

export function updateBugReport(userId, updatedReport) {
  if (!userId || !updatedReport?.id) return;
  const history = getBugHistory(userId);
  const next = history.map((r) => (r.id === updatedReport.id ? { ...r, ...updatedReport } : r));
  write(STORAGE_KEYS.scoped(userId, "history"), next);
}

// ---- In-progress draft (New Bug form & generated report) ----

export function getNewBugDraft(userId) {
  if (!userId) return null;
  migrateLegacyData(userId);
  return read(STORAGE_KEYS.scoped(userId, "new-bug-draft"), null);
}

export function saveNewBugDraft(userId, draft) {
  if (!userId || !draft || typeof draft !== "object") return;
  write(STORAGE_KEYS.scoped(userId, "new-bug-draft"), draft);
}

export function clearNewBugDraft(userId) {
  if (!userId) return;
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEYS.scoped(userId, "new-bug-draft"));
  } catch (e) {
    console.error("Failed to clear new bug draft:", e);
  }
}

// ---- PMS / Redmine URL configuration ----

export function getPMSUrls(userId) {
  if (!userId) {
    return { android: "", ios: "" };
  }
  migrateLegacyData(userId);
  return read(STORAGE_KEYS.scoped(userId, "pms-urls"), {
    android: "",
    ios: "",
  });
}

export function savePMSUrls(userId, urls) {
  if (!userId) return;
  write(STORAGE_KEYS.scoped(userId, "pms-urls"), {
    android: typeof urls?.android === "string" ? urls.android.trim() : "",
    ios: typeof urls?.ios === "string" ? urls.ios.trim() : "",
  });
}

export function resetPMSUrls(userId, defaultAndroid = "", defaultIos = "") {
  if (!userId) return;
  write(STORAGE_KEYS.scoped(userId, "pms-urls"), {
    android: defaultAndroid,
    ios: defaultIos,
  });
}

// ---- User selected platform persistence ----

export function getSelectedPlatform(userId) {
  if (!userId || typeof userId !== "string" || !userId.trim()) return null;
  const cleanId = userId.trim();
  migrateLegacyData(cleanId);
  const val = read(STORAGE_KEYS.scoped(cleanId, "selected-platform"), null);
  if (val === "android" || val === "ios") {
    return val;
  }
  return null;
}

export function saveSelectedPlatform(userId, platform) {
  if (!userId || typeof userId !== "string" || !userId.trim()) return;
  const cleanId = userId.trim();
  if (platform !== "android" && platform !== "ios") return;
  write(STORAGE_KEYS.scoped(cleanId, "selected-platform"), platform);
  if (isBrowser()) {
    try {
      window.dispatchEvent(
        new CustomEvent("bugdesk:platform-updated", {
          detail: { userId: cleanId, platform },
        })
      );
    } catch {}
  }
}

// ---- PMS / Redmine API Access Key (User-scoped credential) ----

export function getPmsApiKey(userId) {
  if (!userId || typeof userId !== "string" || !userId.trim()) return "";
  const cleanId = userId.trim();
  migrateLegacyData(cleanId);
  return read(STORAGE_KEYS.scoped(cleanId, "pms-api-key"), "");
}

export function savePmsApiKey(userId, apiKey) {
  if (!userId || typeof userId !== "string" || !userId.trim()) return;
  const cleanId = userId.trim();
  const val = typeof apiKey === "string" ? apiKey.trim() : "";
  write(STORAGE_KEYS.scoped(cleanId, "pms-api-key"), val);
  if (isBrowser()) {
    try {
      window.dispatchEvent(
        new CustomEvent("bugdesk:pms-key-updated", {
          detail: { userId: cleanId, hasKey: Boolean(val) },
        })
      );
    } catch {}
  }
}

export function clearPmsApiKey(userId) {
  if (!userId || typeof userId !== "string" || !userId.trim()) return;
  const cleanId = userId.trim();
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEYS.scoped(cleanId, "pms-api-key"));
    window.dispatchEvent(
      new CustomEvent("bugdesk:pms-key-updated", {
        detail: { userId: cleanId, hasKey: false },
      })
    );
  } catch (e) {
    console.error("Failed to clear PMS API key:", e);
  }
}



