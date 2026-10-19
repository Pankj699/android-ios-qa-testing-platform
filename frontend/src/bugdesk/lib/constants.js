export const APP_NAME = "BugDesk";

export const STORAGE_KEYS = {
  users: "qabr:users",
  session: "qabr:session",
  scoped: (userId, key) => `qabr:${userId}:${key}`,
};

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

export const GEMINI_MODELS = [
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash (default)" },
  { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
];

export const DEFAULT_RESULT_TEXT = "Analysing by given steps";

export const BUG_DESK_TABS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "new-bug", label: "New Bug" },
  { id: "history", label: "Bug History" },
  { id: "settings", label: "Settings" },
];
