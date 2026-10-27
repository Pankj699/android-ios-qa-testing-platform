/**
 * Centralized PMS (Redmine) Project URL mapping, validation, resolution, and Issue prefill helpers.
 */

export const PMS_PROJECT_URLS = Object.freeze({
  android: "https://pms.optimumbrew.com/projects/cp-photo-editor-suite/issues/new",
  ios: "https://pms.optimumbrew.com/projects/iha_ios/issues/new",
});

export const SUPPORTED_PLATFORMS = Object.freeze([
  { id: "android", label: "Android" },
  { id: "ios", label: "iOS" },
]);

/**
 * Validates a user-supplied Redmine URL.
 * Accepts absolute HTTP or HTTPS URLs.
 * Rejects javascript:, data:, file:, relative, or malformed URLs.
 * @param {string} url
 * @returns {{ valid: boolean, empty: boolean, url: string, error?: string }}
 */
export function validateRedmineUrl(url) {
  if (!url || typeof url !== "string" || !url.trim()) {
    return { valid: true, empty: true, url: "" };
  }

  const trimmed = url.trim();

  // Explicitly guard against dangerous protocol prefixes before URL parsing
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith("javascript:") ||
    lower.startsWith("data:") ||
    lower.startsWith("file:") ||
    lower.startsWith("vbscript:")
  ) {
    return {
      valid: false,
      empty: false,
      url: trimmed,
      error: "Dangerous URL protocol is not allowed. Only HTTP and HTTPS are permitted.",
    };
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return {
        valid: false,
        empty: false,
        url: trimmed,
        error: "Only HTTP and HTTPS URLs are allowed.",
      };
    }
    return { valid: true, empty: false, url: trimmed };
  } catch {
    return {
      valid: false,
      empty: false,
      url: trimmed,
      error: "Please enter a valid absolute URL (e.g., https://pms.optimumbrew.com/projects/.../issues/new).",
    };
  }
}

/**
 * Returns the permanent fallback default Redmine New Issue URL for the given platform.
 * @param {'android'|'ios'} platform
 * @returns {string|null}
 */
export function getPMSDefaultUrl(platform) {
  if (!platform || typeof platform !== "string") return null;
  const key = platform.trim().toLowerCase();
  return PMS_PROJECT_URLS[key] || null;
}

/**
 * Backward-compatible alias for getPMSDefaultUrl.
 * @param {'android'|'ios'} platform
 * @returns {string|null}
 */
export function getPMSProjectUrl(platform) {
  return getPMSDefaultUrl(platform);
}

/**
 * Resolves the effective Redmine URL for a given platform.
 * Logic:
 * 1. If valid custom URL is configured and saved, returns that URL.
 * 2. If setting is empty, missing, null, or whitespace, returns the platform default URL.
 * 3. If configured custom URL is malformed or unsafe, throws a descriptive Error.
 * 4. Resolves Android and iOS independently.
 *
 * @param {'android'|'ios'} platform
 * @param {object} [customUrls] - Optional object with { android?: string, ios?: string }
 * @returns {string}
 */
export function getEffectivePMSProjectUrl(platform, customUrls = null) {
  if (!platform || typeof platform !== "string") {
    throw new Error("Platform is required to resolve Redmine URL.");
  }
  const key = platform.trim().toLowerCase();
  if (key !== "android" && key !== "ios") {
    throw new Error(`Unsupported platform "${platform}". Must be "android" or "ios".`);
  }

  const defaultUrl = PMS_PROJECT_URLS[key];
  const configured = customUrls && typeof customUrls === "object" ? customUrls[key] : null;

  // Case 1: Empty, missing, null, or whitespace -> Fall back to default URL
  if (!configured || typeof configured !== "string" || !configured.trim()) {
    return defaultUrl;
  }

  // Case 2: Custom URL configured -> Validate strictly
  const validation = validateRedmineUrl(configured);
  if (!validation.valid) {
    throw new Error(
      `Invalid custom ${key === "android" ? "Android" : "iOS"} Redmine URL: ${validation.error}`
    );
  }

  return validation.url;
}

/**
 * Detects whether the active project/module context clearly indicates Android or iOS.
 * Returns 'android', 'ios', or null if cannot be determined reliably.
 * Note: Per specifications, platform is NOT inferred solely from generated report title.
 * @param {object} context
 * @returns {'android'|'ios'|null}
 */
export function detectPlatformFromContext(context = {}) {
  const project = String(context?.project || "").trim().toLowerCase();
  const module = String(context?.module || "").trim().toLowerCase();

  // Check for explicit "android"
  const isAndroid =
    project.includes("android") ||
    module.includes("android") ||
    project.startsWith("and_") ||
    module.startsWith("and_");

  // Check for explicit "ios", "iphone", "ipad"
  const isIos =
    project.includes("ios") ||
    module.includes("ios") ||
    project.includes("iphone") ||
    project.includes("ipad") ||
    module.includes("iphone") ||
    module.includes("ipad");

  // If both or neither match, require explicit user selection
  if (isAndroid && !isIos) return "android";
  if (isIos && !isAndroid) return "ios";

  return null;
}

/**
 * Extracts the Redmine project identifier from a full URL.
 * Falls back to platform default project identifier if parsing fails.
 * @param {string} url
 * @param {'android'|'ios'} [platform='android']
 * @returns {string}
 */
export function getProjectIdFromUrl(url, platform = "android") {
  if (url && typeof url === "string" && url.trim()) {
    try {
      const parsed = new URL(url.trim());
      const match = parsed.pathname.match(/\/projects\/([^/]+)/);
      if (match && match[1]) {
        return match[1];
      }
    } catch {}
  }
  return platform === "ios" ? "iha_ios" : "cp-photo-editor-suite";
}

/**
 * Constructs the Redmine New Issue URL with prefilled Subject, Description,
 * Status, Priority, and Assignee.
 * Uses Redmine's standard parameter convention:
 * ?issue[subject]=...&issue[description]=...&issue[status_id]=...&issue[priority_id]=...&issue[assigned_to_id]=...
 *
 * @param {'android'|'ios'} platform
 * @param {{ subject: string, description: string }} data
 * @param {object} [customUrls] - Optional custom URLs { android?: string, ios?: string }
 * @param {{ statusId?: string|number, priorityId?: string|number, assignedToId?: string|number }} [options] - Issue options
 * @returns {string}
 */
export function buildPMSIssueUrl(
  platform,
  { subject = "", description = "" } = {},
  customUrls = null,
  options = {}
) {
  const baseUrl = getEffectivePMSProjectUrl(platform, customUrls);
  const url = new URL(baseUrl);

  if (subject && typeof subject === "string" && subject.trim()) {
    url.searchParams.set("issue[subject]", subject.trim());
  }
  if (description && typeof description === "string" && description.trim()) {
    url.searchParams.set("issue[description]", description.trim());
  }

  if (options && typeof options === "object") {
    // Status prefill (if provided and valid)
    if (
      options.statusId !== undefined &&
      options.statusId !== null &&
      String(options.statusId).trim() !== ""
    ) {
      url.searchParams.set("issue[status_id]", String(options.statusId).trim());
    }

    // Priority prefill (if provided and valid)
    if (
      options.priorityId !== undefined &&
      options.priorityId !== null &&
      String(options.priorityId).trim() !== ""
    ) {
      url.searchParams.set("issue[priority_id]", String(options.priorityId).trim());
    }

    // Assignee prefill (only when assigned to a specific user; empty/null leaves unassigned)
    if (
      options.assignedToId !== undefined &&
      options.assignedToId !== null &&
      String(options.assignedToId).trim() !== ""
    ) {
      url.searchParams.set("issue[assigned_to_id]", String(options.assignedToId).trim());
    }
  }

  return url.toString();
}
