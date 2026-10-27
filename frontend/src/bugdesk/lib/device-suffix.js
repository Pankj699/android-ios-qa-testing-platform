/**
 * Formats a device and OS into the authoritative BugDesk title suffix:
 * " — <Device Display Name> OS <Version>" (or iOS <Version>)
 *
 * Example:
 * - { name: "OPPO CPH2729", os: "Android 16" } -> " — OPPO CPH2729 OS 16"
 * - { name: "OPPO CPH2729", os: "16" }         -> " — OPPO CPH2729 OS 16"
 * - { name: "iPhone 15 Pro", os: "iOS 18.2" }    -> " — iPhone 15 Pro iOS 18.2"
 *
 * @param {{ name?: string, os?: string }} [device]
 * @returns {string} Suffix starting with em-dash " — ", or empty string if no device.
 */
export function formatDeviceSuffix(device) {
  if (!device || typeof device !== "object") return "";

  const name = typeof device.name === "string" ? device.name.trim() : "";
  if (!name) return "";

  const rawOs = typeof device.os === "string" ? device.os.trim() : "";
  if (!rawOs) return ` — ${name}`;

  let osPart = rawOs;
  if (/^android\s*/i.test(rawOs)) {
    osPart = rawOs.replace(/^android\s*/i, "OS ");
  } else if (/^os\s*/i.test(rawOs)) {
    osPart = rawOs.replace(/^os\s*/i, "OS ");
  } else if (/^ios\s*/i.test(rawOs)) {
    // Preserve standard iOS branding (e.g., iOS 18.2)
    const ver = rawOs.replace(/^ios\s*/i, "").trim();
    osPart = `iOS ${ver}`;
  } else if (/^\d/.test(rawOs)) {
    osPart = `OS ${rawOs}`;
  }

  return ` — ${name} ${osPart}`.trimEnd();
}

/**
 * Safely removes any trailing device suffix (e.g. " — OPPO CPH2729 OS 16")
 * without mutating or corrupting the base title.
 *
 * @param {string} title
 * @returns {string} Base title without trailing device suffix.
 */
export function stripDeviceSuffix(title) {
  if (!title || typeof title !== "string") return "";

  // Matches trailing " — Device Name ..." or " -- Device Name ..."
  return title
    .replace(/\s*(?:—|--)\s*([^—]+)$/, "")
    .trim();
}

/**
 * Applies the selected device suffix to a bug title.
 * Idempotent: repeated calls will never duplicate the suffix.
 * If device is null/empty, returns pristine base title without suffix.
 *
 * @param {string} baseTitle
 * @param {{ name?: string, os?: string } | null} [device]
 * @returns {string}
 */
export function applyDeviceSuffix(baseTitle, device) {
  if (!baseTitle || typeof baseTitle !== "string") return "";

  const cleanBase = stripDeviceSuffix(baseTitle);
  const suffix = formatDeviceSuffix(device);

  return suffix ? `${cleanBase}${suffix}` : cleanBase;
}
