import * as React from "react";
import { Eye, EyeOff, Loader2, CheckCircle2, XCircle, Repeat, Save, ShieldCheck, HardDrive, Folder, RotateCcw, AlertCircle, ExternalLink, Key, LogOut, Smartphone, Plus, Pencil, Trash2, Download, Upload, Search } from "lucide-react";

function GoogleLogo({ className = "w-4 h-4" }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
      />
    </svg>
  );
}
import { toast } from "sonner";
import { PageHeader } from "../components/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { Separator } from "../components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { SwitchModuleDialog } from "../components/SwitchModuleDialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import DriveFolderSelectorModal from "../../components/DriveFolderSelectorModal";
import { api } from "../../services/api";
import { useAuth } from "../context/auth-context";
import { useModuleSettings } from "../hooks/use-module-settings";
import { getAISettings, saveAISettings, getPMSUrls, savePMSUrls, getPmsApiKey, savePmsApiKey } from "../lib/scoped-storage";
import { GEMINI_MODELS } from "../lib/constants";
import { PMS_PROJECT_URLS, validateRedmineUrl } from "../lib/pms-integration";

export function BugDeskSettings() {
  const { session } = useAuth();
  const { settings, update } = useModuleSettings();

  const [apiKey, setApiKey] = React.useState("");
  const [model, setModel] = React.useState("gemini-2.5-flash");
  const [showKey, setShowKey] = React.useState(false);
  const [connection, setConnection] = React.useState("idle");
  const [connectionError, setConnectionError] = React.useState(null);
  const [switchOpen, setSwitchOpen] = React.useState(false);

  // Google Drive Recording & Attachments settings
  const [driveStatus, setDriveStatus] = React.useState(null);
  const [defaultFolder, setDefaultFolder] = React.useState(null);
  const [folderLoading, setFolderLoading] = React.useState(true);
  const [folderRefreshing, setFolderRefreshing] = React.useState(false);
  const [folderUnavailable, setFolderUnavailable] = React.useState(false);
  const [folderPickerOpen, setFolderPickerOpen] = React.useState(false);
  const [isConnectingGoogle, setIsConnectingGoogle] = React.useState(false);
  const [isDisconnectingGoogle, setIsDisconnectingGoogle] = React.useState(false);

  // PMS / Redmine Integration settings
  const [androidUrl, setAndroidUrl] = React.useState("");
  const [iosUrl, setIosUrl] = React.useState("");
  const [pmsErrors, setPmsErrors] = React.useState({ android: null, ios: null });
  const [pmsApiKey, setPmsApiKey] = React.useState("");
  const [showPmsKey, setShowPmsKey] = React.useState(false);
  const [pmsConnection, setPmsConnection] = React.useState("idle");
  const [pmsConnectionError, setPmsConnectionError] = React.useState(null);
  const [pmsConnectedUser, setPmsConnectedUser] = React.useState(null);

  // Shared Device & OS Catalog
  const [devices, setDevices] = React.useState([]);
  const [devicesLoading, setDevicesLoading] = React.useState(true);
  const [devicesError, setDevicesError] = React.useState(null);
  const [devicesSearch, setDevicesSearch] = React.useState("");
  const [deviceModalOpen, setDeviceModalOpen] = React.useState(false);
  const [editingDevice, setEditingDevice] = React.useState(null);
  const [deviceForm, setDeviceForm] = React.useState({ name: "", os: "", manufacturer: "", model: "" });
  const [deviceFormError, setDeviceFormError] = React.useState(null);
  const [isSavingDevice, setIsSavingDevice] = React.useState(false);
  const fileInputRef = React.useRef(null);

  const fetchDevices = React.useCallback(async () => {
    setDevicesLoading(true);
    setDevicesError(null);
    try {
      const res = await api.getBugDeskDevices();
      if (res?.success) {
        setDevices(res.devices || []);
      }
    } catch (err) {
      setDevicesError(err.message || "Failed to load device catalog.");
    } finally {
      setDevicesLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchDevices();
  }, [fetchDevices]);

  React.useEffect(() => {
    if (!session?.userId) return;
    const ai = getAISettings(session.userId);
    setApiKey(ai.apiKey || "");
    setModel(ai.model || "gemini-2.5-flash");

    // Load PMS / Redmine configured URLs and API key
    const pms = getPMSUrls(session.userId);
    setAndroidUrl(pms.android || "");
    setIosUrl(pms.ios || "");
    const savedPmsKey = getPmsApiKey(session.userId);
    setPmsApiKey(savedPmsKey || "");

    // Load Drive status & configured default folder
    api.getDriveStatus()
      .then((st) => setDriveStatus(st))
      .catch(() => {});

    setFolderLoading(true);
    setFolderUnavailable(false);

    api.getDriveDefaultFolder()
      .then(async (res) => {
        if (res?.success) {
          const folderId = res.defaultFolderId;
          const folderName = res.defaultFolderName;

          if (!folderId || folderId === 'root') {
            setDefaultFolder({ id: 'root', name: 'My Drive (Root)' });
            setFolderUnavailable(false);
            setFolderLoading(false);
            return;
          }

          // If folder name is already available and not raw ID, show immediately (Req 5 & Req 8)
          if (folderName && folderName.trim() && folderName.trim() !== folderId) {
            setDefaultFolder({ id: folderId, name: folderName.trim() });
            setFolderLoading(false);

            // In background, verify if renamed or deleted in Google Drive (Req 6 & Req 7)
            api.getDriveFileMetadata(folderId)
              .then((metaRes) => {
                if (metaRes?.success && metaRes.file) {
                  if (metaRes.file.trashed) {
                    setFolderUnavailable(true);
                  } else {
                    setFolderUnavailable(false);
                    if (metaRes.file.name && metaRes.file.name !== folderName.trim()) {
                      setDefaultFolder({ id: folderId, name: metaRes.file.name });
                      api.setDriveDefaultFolder(folderId, metaRes.file.name).catch(() => {});
                    }
                  }
                }
              })
              .catch((err) => {
                if (err?.status === 404 || err?.status === 403 || err?.message?.includes('not found')) {
                  setFolderUnavailable(true);
                }
              });
          } else {
            // Name not yet available: resolve saved folder ID to folder name (Req 4)
            try {
              const metaRes = await api.getDriveFileMetadata(folderId);
              if (metaRes?.success && metaRes.file) {
                if (metaRes.file.trashed) {
                  setFolderUnavailable(true);
                  setDefaultFolder({ id: folderId, name: null });
                } else {
                  const resolvedName = metaRes.file.name || 'Folder';
                  setDefaultFolder({ id: folderId, name: resolvedName });
                  setFolderUnavailable(false);
                  api.setDriveDefaultFolder(folderId, resolvedName).catch(() => {});
                }
              } else {
                setFolderUnavailable(true);
                setDefaultFolder({ id: folderId, name: null });
              }
            } catch (err) {
              setFolderUnavailable(true);
              setDefaultFolder({ id: folderId, name: null });
            } finally {
              setFolderLoading(false);
            }
          }
        } else {
          setDefaultFolder({ id: 'root', name: 'My Drive (Root)' });
          setFolderLoading(false);
        }
      })
      .catch(() => {
        setDefaultFolder({ id: 'root', name: 'My Drive (Root)' });
        setFolderLoading(false);
      });
  }, [session?.userId]);

  async function handleRefreshFolderMetadata() {
    if (!defaultFolder?.id || defaultFolder.id === 'root') return;
    setFolderRefreshing(true);
    try {
      const metaRes = await api.getDriveFileMetadata(defaultFolder.id);
      if (metaRes?.success && metaRes.file) {
        if (metaRes.file.trashed) {
          setFolderUnavailable(true);
          toast.error('The selected folder was moved to trash in Google Drive.');
        } else {
          const updatedName = metaRes.file.name || 'Folder';
          setDefaultFolder((prev) => ({ ...prev, name: updatedName }));
          setFolderUnavailable(false);
          await api.setDriveDefaultFolder(defaultFolder.id, updatedName);
          toast.success(`Folder name refreshed: "${updatedName}"`);
        }
      } else {
        setFolderUnavailable(true);
        toast.error('Folder is unavailable in Google Drive.');
      }
    } catch (err) {
      setFolderUnavailable(true);
      toast.error('Could not access folder in Google Drive. It may have been deleted or permissions changed.');
    } finally {
      setFolderRefreshing(false);
    }
  }

  const handleConnectGoogle = async () => {
    setIsConnectingGoogle(true);
    try {
      const res = await api.getDriveAuthUrl(null, window.location.origin);
      if (!res?.url) {
        throw new Error('Failed to generate Google authorization URL');
      }

      const w = 600;
      const h = 720;
      const left = window.screen.width / 2 - w / 2;
      const top = window.screen.height / 2 - h / 2;
      const popup = window.open(
        res.url,
        'google_oauth_popup',
        `width=${w},height=${h},top=${top},left=${left},status=no,menubar=no,toolbar=no`
      );

      if (!popup) {
        toast.error('Popup was blocked by browser. Please allow popups for this site.');
        setIsConnectingGoogle(false);
        return;
      }

      let handled = false;
      let checkTimer = null;
      let messageListener = null;
      let broadcastChannel = null;

      const cleanup = () => {
        if (checkTimer) {
          clearInterval(checkTimer);
          checkTimer = null;
        }
        if (messageListener) {
          window.removeEventListener('message', messageListener);
          messageListener = null;
        }
        if (broadcastChannel) {
          try { broadcastChannel.close(); } catch (_) {}
          broadcastChannel = null;
        }
      };

      const handleSuccess = async () => {
        if (handled) return;
        handled = true;
        cleanup();
        if (popup && !popup.closed) {
          try { popup.close(); } catch (_) {}
        }
        try {
          const st = await api.getDriveStatus();
          setDriveStatus(st);
        } catch (_) {}
        toast.success('Google account connected successfully!');
        setIsConnectingGoogle(false);
      };

      const handleError = (errMsg) => {
        if (handled) return;
        handled = true;
        cleanup();
        if (popup && !popup.closed) {
          try { popup.close(); } catch (_) {}
        }
        toast.error(errMsg || 'Google authorization failed.');
        setIsConnectingGoogle(false);
      };

      if (typeof BroadcastChannel !== 'undefined') {
        broadcastChannel = new BroadcastChannel('gdrive_oauth_channel');
        broadcastChannel.onmessage = (event) => {
          if (event.data?.type === 'GDRIVE_AUTH_SUCCESS') {
            handleSuccess();
          } else if (event.data?.type === 'GDRIVE_AUTH_ERROR') {
            handleError(event.data.error);
          }
        };
      }

      messageListener = (event) => {
        if (event.origin !== window.location.origin) return;
        if (event.data?.type === 'GDRIVE_AUTH_SUCCESS') {
          handleSuccess();
        } else if (event.data?.type === 'GDRIVE_AUTH_ERROR') {
          handleError(event.data.error);
        }
      };
      window.addEventListener('message', messageListener);

      checkTimer = setInterval(async () => {
        if (popup && popup.closed) {
          cleanup();
          if (!handled) {
            handled = true;
            setIsConnectingGoogle(false);
            try {
              const st = await api.getDriveStatus();
              if (st?.connected) {
                setDriveStatus(st);
                toast.success('Google account connected!');
              }
            } catch (_) {}
          }
        }
      }, 600);
    } catch (err) {
      toast.error(err.message || 'Failed to start Google sign-in.');
      setIsConnectingGoogle(false);
    }
  };

  const handleDisconnectGoogle = async () => {
    const confirmed = window.confirm(
      "Disconnect your Google account from BugDesk?\n\nYour saved Gemini API key, drafts, and PMS configuration will remain intact."
    );
    if (!confirmed) return;

    setIsDisconnectingGoogle(true);
    try {
      await api.disconnectDrive();
      setDriveStatus({ connected: false });
      setDefaultFolder({ id: 'root', name: 'My Drive (Root)' });
      toast.success("Google account disconnected.");
    } catch (err) {
      toast.error("Failed to disconnect Google account: " + (err.message || "Unknown error"));
    } finally {
      setIsDisconnectingGoogle(false);
    }
  };

  function handleSaveKey() {
    if (!session?.userId) return;
    saveAISettings(session.userId, { apiKey: apiKey.trim(), model });
    setConnection("idle");
    setConnectionError(null);
    toast.success("Gemini settings saved.");
  }

  function handleSavePMSUrls() {
    if (!session?.userId) return;

    const errors = { android: null, ios: null };

    if (androidUrl && androidUrl.trim()) {
      const v = validateRedmineUrl(androidUrl);
      if (!v.valid) {
        errors.android = v.error;
      }
    }

    if (iosUrl && iosUrl.trim()) {
      const v = validateRedmineUrl(iosUrl);
      if (!v.valid) {
        errors.ios = v.error;
      }
    }

    if (errors.android || errors.ios) {
      setPmsErrors(errors);
      toast.error("Please correct invalid Redmine URL(s) before saving.");
      return;
    }

    setPmsErrors({ android: null, ios: null });
    savePMSUrls(session.userId, {
      android: androidUrl.trim(),
      ios: iosUrl.trim(),
    });
    savePmsApiKey(session.userId, pmsApiKey.trim());
    setPmsConnection("idle");
    setPmsConnectionError(null);
    toast.success("PMS / Redmine configuration saved.");
  }

  async function handleTestPMSConnection() {
    if (!pmsApiKey.trim()) {
      setPmsConnection("failed");
      setPmsConnectionError("Enter a Redmine API key first.");
      return;
    }
    setPmsConnection("testing");
    setPmsConnectionError(null);
    try {
      const res = await api.testBugDeskPmsConnection(pmsApiKey.trim());
      if (res?.connected) {
        setPmsConnection("connected");
        setPmsConnectedUser(res.user?.name || res.user?.login || "Verified");
        toast.success(`Redmine API connection verified${res.user?.name ? `: ${res.user.name}` : ""}!`);
      } else {
        setPmsConnection("failed");
        setPmsConnectionError(res?.error || "Invalid Redmine API key.");
        toast.error(res?.error || "Redmine connection failed.");
      }
    } catch (err) {
      setPmsConnection("failed");
      setPmsConnectionError(err.message || "Could not reach server.");
      toast.error(err.message || "Network error testing Redmine connection.");
    }
  }

  function handleResetPMSUrls() {
    if (!session?.userId) return;

    const confirmed = window.confirm(
      "Reset Redmine project URLs to platform defaults?\n\nAndroid:\n" +
        PMS_PROJECT_URLS.android +
        "\n\niOS:\n" +
        PMS_PROJECT_URLS.ios
    );
    if (!confirmed) return;

    setAndroidUrl(PMS_PROJECT_URLS.android);
    setIosUrl(PMS_PROJECT_URLS.ios);
    setPmsErrors({ android: null, ios: null });
    savePMSUrls(session.userId, {
      android: PMS_PROJECT_URLS.android,
      ios: PMS_PROJECT_URLS.ios,
    });
    toast.success("Redmine URLs restored and saved to platform defaults.");
  }

  async function handleTestConnection() {
    if (!apiKey.trim()) {
      setConnection("failed");
      setConnectionError("Add an API key first.");
      return;
    }
    setConnection("testing");
    setConnectionError(null);
    try {
      const res = await fetch("/api/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ apiKey: apiKey.trim(), model }),
      });
      const data = await res.json();
      if (data.connected) {
        setConnection("connected");
        toast.success("Gemini API connection verified!");
      } else {
        setConnection("failed");
        setConnectionError(data.error || "Invalid API key.");
        toast.error(data.error || "Connection failed.");
      }
    } catch {
      setConnection("failed");
      setConnectionError("Could not reach the server.");
      toast.error("Network error reaching test endpoint.");
    }
  }

  const filteredDevices = React.useMemo(() => {
    const q = devicesSearch.trim().toLowerCase();
    if (!q) return devices;
    return devices.filter((d) => {
      const n = (d.name || "").toLowerCase();
      const o = (d.os || "").toLowerCase();
      const m = (d.manufacturer || "").toLowerCase();
      const mdl = (d.model || "").toLowerCase();
      return n.includes(q) || o.includes(q) || m.includes(q) || mdl.includes(q);
    });
  }, [devices, devicesSearch]);

  function handleOpenAddDevice() {
    setEditingDevice(null);
    setDeviceForm({ name: "", os: "", manufacturer: "", model: "" });
    setDeviceFormError(null);
    setDeviceModalOpen(true);
  }

  function handleOpenEditDevice(device) {
    setEditingDevice(device);
    setDeviceForm({
      name: device.name || "",
      os: device.os || "",
      manufacturer: device.manufacturer || "",
      model: device.model || ""
    });
    setDeviceFormError(null);
    setDeviceModalOpen(true);
  }

  async function handleSaveDevice(e) {
    if (e && e.preventDefault) e.preventDefault();
    const trimmedName = deviceForm.name.trim();
    const trimmedOs = deviceForm.os.trim();

    if (!trimmedName) {
      setDeviceFormError("Device display name is required.");
      return;
    }
    if (!trimmedOs) {
      setDeviceFormError("OS display/version is required.");
      return;
    }

    setIsSavingDevice(true);
    setDeviceFormError(null);
    try {
      if (editingDevice) {
        await api.updateBugDeskDevice(editingDevice.id, {
          name: trimmedName,
          os: trimmedOs,
          manufacturer: deviceForm.manufacturer.trim(),
          model: deviceForm.model.trim()
        });
        toast.success(`Updated device "${trimmedName}" in shared catalog.`);
      } else {
        await api.createBugDeskDevice({
          name: trimmedName,
          os: trimmedOs,
          manufacturer: deviceForm.manufacturer.trim(),
          model: deviceForm.model.trim()
        });
        toast.success(`Added "${trimmedName}" to shared catalog.`);
      }
      setDeviceModalOpen(false);
      await fetchDevices();
    } catch (err) {
      setDeviceFormError(err.message || "Failed to save device.");
    } finally {
      setIsSavingDevice(false);
    }
  }

  async function handleDeleteDevice(device) {
    const confirmed = window.confirm(
      `Are you sure you want to delete "${device.name}" (${device.os}) from the shared catalog?\n\nThis device will be removed for all team members.`
    );
    if (!confirmed) return;

    try {
      await api.deleteBugDeskDevice(device.id);
      toast.success(`Removed "${device.name}" from shared catalog.`);
      await fetchDevices();
    } catch (err) {
      toast.error(err.message || "Failed to delete device.");
    }
  }

  function handleExportDevicesCSV() {
    if (!devices.length) {
      toast.error("No devices to export.");
      return;
    }
    const headers = "Name,OS,Manufacturer,Model\n";
    const rows = devices
      .map(
        (d) =>
          `"${(d.name || "").replace(/"/g, '""')}","${(d.os || "").replace(/"/g, '""')}","${(d.manufacturer || "").replace(/"/g, '""')}","${(d.model || "").replace(/"/g, '""')}"`
      )
      .join("\n");
    const blob = new Blob([headers + rows], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bugdesk-devices.csv";
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Shared device catalog exported to CSV.");
  }

  async function handleImportDevicesCSV(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length <= 1) {
        toast.error("CSV file appears to be empty or only contains headers.");
        return;
      }

      const parseCsvLine = (line) => {
        const result = [];
        let cur = "";
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
              cur += '"';
              i++;
            } else {
              inQuotes = !inQuotes;
            }
          } else if (ch === ',' && !inQuotes) {
            result.push(cur.trim());
            cur = "";
          } else {
            cur += ch;
          }
        }
        result.push(cur.trim());
        return result;
      };

      const headerCols = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
      const nameIdx = headerCols.findIndex((h) => h.includes("name") || h.includes("device"));
      const osIdx = headerCols.findIndex((h) => h.includes("os") || h.includes("version"));
      const mfgIdx = headerCols.findIndex((h) => h.includes("manufacturer") || h.includes("brand"));
      const modelIdx = headerCols.findIndex((h) => h.includes("model"));

      let importedCount = 0;
      let skippedCount = 0;

      for (let i = 1; i < lines.length; i++) {
        const cols = parseCsvLine(lines[i]);
        const name = nameIdx !== -1 ? cols[nameIdx] : cols[0];
        const os = osIdx !== -1 ? cols[osIdx] : cols[1];
        const manufacturer = mfgIdx !== -1 ? cols[mfgIdx] : (cols[2] || "");
        const model = modelIdx !== -1 ? cols[modelIdx] : (cols[3] || "");

        if (!name || !os) {
          skippedCount++;
          continue;
        }

        try {
          await api.createBugDeskDevice({ name, os, manufacturer, model });
          importedCount++;
        } catch {
          skippedCount++;
        }
      }

      toast.success(`Import complete: ${importedCount} device(s) added, ${skippedCount} skipped (duplicates/invalid).`);
      await fetchDevices();
    } catch (err) {
      toast.error("Failed to parse CSV file: " + err.message);
    } finally {
      e.target.value = "";
    }
  }

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Configure your Gemini AI connection, project module context, and workspace account."
      />

      <div className="max-w-4xl space-y-6 px-8 pb-8">
        {/* Google Account & Gemini API Setup */}
        <Card className="border-slate-200 bg-white dark:border-[#1A2234] dark:bg-[#0E131F] shadow-sm dark:shadow-none">
          <CardHeader className="border-b border-slate-200 dark:border-[#1A2234] pb-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <CardTitle className="text-[16.5px] font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Key className="h-4 w-4 text-amber-500 dark:text-amber-400" /> Google Account &amp; Gemini API Setup
                </CardTitle>
                <CardDescription className="text-[13px] text-slate-500 dark:text-[#8F97A6] mt-0.5">
                  Connect your Google account and configure your Gemini API key for AI-assisted bug report generation.
                </CardDescription>
              </div>
              <div>
                {driveStatus?.connected ? (
                  <Badge variant="success" className="gap-1.5 py-1 px-3 text-[12px]">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Google Connected
                  </Badge>
                ) : (
                  <Badge variant="outline" className="gap-1.5 py-1 px-3 text-[12px] border-amber-500/30 text-amber-500 dark:text-amber-400 bg-amber-500/10">
                    Not Connected
                  </Badge>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5 pt-5">
            {/* 1. Google Account Connection Section */}
            <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-[#080B12] border border-slate-200 dark:border-[#1A2234] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-full bg-white dark:bg-[#141A28] border border-slate-200 dark:border-[#232D42] flex items-center justify-center shrink-0 shadow-xs">
                  <GoogleLogo className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] text-slate-500 dark:text-[#8F97A6] uppercase tracking-wider font-semibold">Google Account Status</p>
                  <p className="font-semibold text-slate-900 dark:text-white text-[13.5px] truncate mt-0.5">
                    {driveStatus?.connected
                      ? driveStatus.email || driveStatus.name || 'Connected'
                      : 'No Google account connected'}
                  </p>
                  <p className="text-[11.5px] text-slate-500 dark:text-[#8F97A6]">
                    {driveStatus?.connected
                      ? 'Authenticated via Google OAuth for Drive and identity services.'
                      : 'Connect your account to streamline Google Drive attachments and Gemini setup.'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {!driveStatus?.connected ? (
                  <Button
                    onClick={handleConnectGoogle}
                    disabled={isConnectingGoogle}
                    className="h-9 bg-slate-900 hover:bg-slate-800 text-white dark:bg-white dark:hover:bg-slate-100 dark:text-slate-900 font-bold text-[12.5px] px-3.5 shadow-sm"
                  >
                    {isConnectingGoogle ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                    ) : (
                      <GoogleLogo className="w-3.5 h-3.5 mr-1.5" />
                    )}
                    Connect Google Account
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDisconnectGoogle}
                    disabled={isDisconnectingGoogle}
                    className="h-9 border-slate-200 dark:border-[#263248] text-rose-500 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 hover:border-rose-300 dark:hover:border-rose-500/30 text-[12.5px]"
                  >
                    {isDisconnectingGoogle ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                    ) : (
                      <LogOut className="w-3.5 h-3.5 mr-1.5" />
                    )}
                    Disconnect Google
                  </Button>
                )}
              </div>
            </div>

            {/* 2. Official Gemini API Key Provisioning Guidance */}
            <div className="p-3.5 rounded-lg bg-slate-50/80 dark:bg-[#080B12]/80 border border-slate-200 dark:border-[#1A2234] space-y-2.5">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <Key className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" />
                    How to Provision your Gemini API Key
                  </p>
                  <p className="text-[12px] text-slate-500 dark:text-[#8F97A6] leading-relaxed max-w-xl">
                    Google account sign-in verifies your identity, while Gemini API keys are separate project credentials.
                    Generate your key in one click via official Google AI Studio, then paste it below.
                  </p>
                </div>

                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 text-[12px] font-semibold transition-colors shrink-0"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Get Key from Google AI Studio
                </a>
              </div>

              {/* Step-by-step guidance */}
              <div className="bg-white dark:bg-[#0D121F] rounded p-2.5 border border-slate-200 dark:border-[#1E2638] text-[11.5px] text-slate-700 dark:text-slate-300">
                <span className="font-semibold text-amber-600 dark:text-amber-400">3-Step Quick Guide: </span>
                <span className="text-slate-500 dark:text-[#8F97A6]">
                  1. Open <strong className="text-slate-800 dark:text-slate-200">Google AI Studio</strong> using the button above. &rarr;{" "}
                  2. Click <strong className="text-slate-800 dark:text-slate-200">"Create API key"</strong>. &rarr;{" "}
                  3. Copy your key (starts with <code className="font-mono text-amber-600 dark:text-amber-400/90">AIzaSy...</code>) and paste below.
                </span>
              </div>
            </div>

            {/* 3. API Key & Model Configuration */}
            <div className="space-y-4 pt-1">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="apiKey" className="text-[13px] font-semibold text-slate-700 dark:text-slate-200">
                    Gemini API Key
                  </label>
                  <span className="text-[11.5px] text-slate-500 dark:text-[#8F97A6]">
                    Stored locally in this browser, securely scoped to your account.
                  </span>
                </div>
                <div className="relative">
                  <Input
                    id="apiKey"
                    type={showKey ? "text" : "password"}
                    placeholder="AIzaSy..."
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      setConnection("idle");
                    }}
                    className="h-10 pr-10 bg-white dark:bg-[#080B12] border-slate-200 dark:border-[#1E2638] text-slate-900 dark:text-white text-[13.5px] font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((s) => !s)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-[#8F97A6] hover:text-slate-600 dark:hover:text-white"
                    aria-label={showKey ? "Hide API key" : "Show API key"}
                  >
                    {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-slate-700 dark:text-slate-200">Gemini Model</label>
                <Select value={model} onValueChange={(v) => setModel(v)}>
                  <SelectTrigger className="h-10 bg-white dark:bg-[#080B12] border-slate-200 dark:border-[#1E2638] text-slate-900 dark:text-white text-[13.5px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-white dark:bg-[#0E131F] border-slate-200 dark:border-[#1A2234] text-slate-900 dark:text-white text-[13.5px]">
                    {GEMINI_MODELS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <Button onClick={handleSaveKey} className="h-10 btn-primary-gradient text-white font-bold text-[13.5px] shadow-sm">
                  <Save className="h-4 w-4 mr-1.5" /> Save API Key
                </Button>
                <Button
                  variant="outline"
                  onClick={handleTestConnection}
                  disabled={connection === "testing"}
                  className="h-10 border-slate-200 dark:border-[#263248] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#1A2234] text-[13.5px]"
                >
                  {connection === "testing" && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
                  Test AI Connection
                </Button>

                {connection === "connected" && (
                  <Badge variant="success" className="gap-1.5 py-1.5 px-3 text-[12.5px]">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Gemini Connected
                  </Badge>
                )}
                {connection === "failed" && (
                  <Badge variant="destructive" className="gap-1.5 py-1.5 px-3 text-[12.5px]">
                    <XCircle className="h-3.5 w-3.5" /> Invalid Key
                  </Badge>
                )}
              </div>
              {connection === "failed" && connectionError && (
                <p className="text-[13px] text-rose-500 dark:text-rose-400 mt-1">{connectionError}</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Project Context */}
        <Card className="border-slate-200 bg-white dark:border-[#1A2234] dark:bg-[#0E131F] shadow-sm dark:shadow-none">
          <CardHeader className="border-b border-slate-200 dark:border-[#1A2234] pb-4">
            <CardTitle className="text-[16.5px] font-bold text-slate-900 dark:text-white">Project Context</CardTitle>
            <CardDescription className="text-[13px] text-slate-500 dark:text-[#8F97A6]">Used to build the heading line and metadata on every generated report.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-5">
            <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
              <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-[#080B12] border border-slate-200 dark:border-[#1A2234]">
                <p className="text-[11px] text-slate-500 dark:text-[#8F97A6] uppercase tracking-wider font-semibold">Project</p>
                <p className="font-semibold text-slate-900 dark:text-white mt-1 truncate text-[14px]">{settings?.project ?? "Not configured"}</p>
              </div>
              <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-[#080B12] border border-slate-200 dark:border-[#1A2234]">
                <p className="text-[11px] text-slate-500 dark:text-[#8F97A6] uppercase tracking-wider font-semibold">Module</p>
                <p className="font-semibold text-slate-900 dark:text-white mt-1 truncate text-[14px]">{settings?.module ?? "Not configured"}</p>
              </div>
              <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-[#080B12] border border-slate-200 dark:border-[#1A2234]">
                <p className="text-[11px] text-slate-500 dark:text-[#8F97A6] uppercase tracking-wider font-semibold">Round</p>
                {settings?.round && settings.round.trim() ? (
                  <p className="font-mono font-semibold text-amber-600 dark:text-amber-400 mt-1 text-[14px] truncate">{settings.round.trim()}</p>
                ) : (
                  <p className="text-slate-400 dark:text-[#8F97A6] mt-1 text-[13.5px] italic">Not set (Optional)</p>
                )}
              </div>
            </div>
            <div className="pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSwitchOpen(true)}
                className="h-10 border-slate-200 dark:border-[#263248] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#1A2234] text-[13.5px]"
              >
                <Repeat className="h-4 w-4 mr-2 text-violet-600 dark:text-violet-400" /> Switch Module / Round
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Recording & Attachments (Google Drive Integration) */}
        <Card className="border-slate-200 bg-white dark:border-[#1A2234] dark:bg-[#0E131F] shadow-sm dark:shadow-none">
          <CardHeader className="border-b border-slate-200 dark:border-[#1A2234] pb-4">
            <CardTitle className="text-[16.5px] font-bold text-slate-900 dark:text-white">Recording &amp; Attachments</CardTitle>
            <CardDescription className="text-[13px] text-slate-500 dark:text-[#8F97A6]">
              Configure your Google Drive destination folder for automated BugDesk screen recordings.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-5">
            {/* Drive Connection Status */}
            <div className="flex items-center justify-between p-3.5 rounded-lg bg-slate-50 dark:bg-[#080B12] border border-slate-200 dark:border-[#1A2234]">
              <div>
                <p className="text-[11px] text-slate-500 dark:text-[#8F97A6] uppercase tracking-wider font-semibold">Google Drive Connection</p>
                <p className="text-[13.5px] font-semibold text-slate-900 dark:text-white mt-0.5">
                  {driveStatus?.connected
                    ? driveStatus.email || 'Connected'
                    : 'Not Connected'}
                </p>
              </div>
              {driveStatus?.connected ? (
                <Badge variant="success" className="gap-1.5 py-1.5 px-3 text-[12px]">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Connected
                </Badge>
              ) : (
                <Badge variant="outline" className="gap-1.5 py-1.5 px-3 text-[12px] border-amber-500/30 text-amber-500 dark:text-amber-400 bg-amber-500/10">
                  Not Connected
                </Badge>
              )}
            </div>

            {/* Default Recording Folder */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[13px] font-semibold text-slate-700 dark:text-slate-200">
                  Default Recording Folder
                </label>
                {defaultFolder?.id && defaultFolder.id !== 'root' && (
                  <button
                    type="button"
                    onClick={handleRefreshFolderMetadata}
                    disabled={folderRefreshing || !driveStatus?.connected}
                    title="Refresh folder name and status from Google Drive"
                    className="text-[11.5px] text-slate-500 dark:text-[#8F97A6] hover:text-amber-500 dark:hover:text-amber-400 flex items-center gap-1 transition-colors disabled:opacity-40"
                  >
                    <RotateCcw className={`w-3 h-3 ${folderRefreshing ? 'animate-spin text-amber-500 dark:text-amber-400' : ''}`} />
                    <span>{folderRefreshing ? 'Refreshing...' : 'Refresh'}</span>
                  </button>
                )}
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-lg bg-slate-50 dark:bg-[#080B12] border border-slate-200 dark:border-[#1A2234]">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                    folderUnavailable
                      ? 'bg-red-500/10 border border-red-500/20 text-red-500 dark:text-red-400'
                      : 'bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400'
                  }`}>
                    {folderUnavailable ? (
                      <AlertCircle className="w-4 h-4" />
                    ) : (
                      <Folder className="w-4 h-4" />
                    )}
                  </div>

                  <div className="min-w-0">
                    {folderLoading ? (
                      <div className="flex items-center gap-2">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-500 dark:text-amber-400" />
                        <span className="text-[13px] text-slate-500 dark:text-[#8F97A6]">Loading folder...</span>
                      </div>
                    ) : folderUnavailable ? (
                      <div className="min-w-0">
                        <p className="font-semibold text-red-500 dark:text-red-400 text-[13.5px] truncate">
                          Folder unavailable
                        </p>
                        <p className="text-[11.5px] text-slate-500 dark:text-[#8F97A6] truncate">
                          The configured folder is missing or inaccessible in Google Drive.
                        </p>
                      </div>
                    ) : (
                      <div className="min-w-0">
                        <p
                          className="font-semibold text-slate-900 dark:text-white text-[13.5px] truncate"
                          title={defaultFolder?.name || 'My Drive (Root)'}
                        >
                          {defaultFolder?.name || 'My Drive (Root)'}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  disabled={!driveStatus?.connected}
                  onClick={() => setFolderPickerOpen(true)}
                  className="h-9 border-slate-200 dark:border-[#263248] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#1A2234] text-[13px] shrink-0"
                >
                  <Folder className="h-3.5 w-3.5 mr-1.5 text-violet-600 dark:text-violet-400" />
                  {defaultFolder?.id && defaultFolder.id !== 'root' ? 'Change Folder' : 'Choose Folder'}
                </Button>
              </div>
              {!driveStatus?.connected && (
                <p className="text-[12px] text-amber-600 dark:text-amber-400/80">
                  Connect your Google Drive in the QA Platform sidebar to select a destination folder.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* PMS / Redmine Integration */}
        <Card className="border-slate-200 bg-white dark:border-[#1A2234] dark:bg-[#0E131F] shadow-sm dark:shadow-none">
          <CardHeader className="border-b border-slate-200 dark:border-[#1A2234] pb-4">
            <CardTitle className="text-[16.5px] font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <ExternalLink className="h-4 w-4 text-violet-600 dark:text-violet-400" />
              PMS / Redmine Integration
            </CardTitle>
            <CardDescription className="text-[13px] text-slate-500 dark:text-[#8F97A6]">
              Configure destination Redmine project URLs for automated issue creation with prefilled Subject and Description.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-5">
            {/* Android Project URL */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="androidUrl" className="text-[13px] font-semibold text-slate-700 dark:text-slate-200">
                  Android Redmine Project URL
                </label>
                <span className="text-[11.5px] text-slate-500 dark:text-[#8F97A6]">
                  Default fallback active if empty
                </span>
              </div>
              <Input
                id="androidUrl"
                type="url"
                placeholder={PMS_PROJECT_URLS.android}
                value={androidUrl}
                onChange={(e) => {
                  setAndroidUrl(e.target.value);
                  if (pmsErrors.android) setPmsErrors((prev) => ({ ...prev, android: null }));
                }}
                className={`bg-white dark:bg-[#080B12] border-slate-200 dark:border-[#1E2638] text-[13.5px] text-slate-900 dark:text-white h-10 px-3.5 placeholder:text-slate-400 dark:placeholder:text-[#525A6C] rounded-lg ${
                  pmsErrors.android ? "border-red-500 focus:border-red-500" : "focus:border-purple-500 dark:focus:border-[#7c6cf6]"
                }`}
              />
              {pmsErrors.android ? (
                <p className="text-[12px] text-red-500 dark:text-red-400">{pmsErrors.android}</p>
              ) : (
                <p className="text-[11.5px] text-slate-500 dark:text-[#8F97A6] truncate font-mono">
                  Default: {PMS_PROJECT_URLS.android}
                </p>
              )}
            </div>

            {/* iOS Project URL */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="iosUrl" className="text-[13px] font-semibold text-slate-700 dark:text-slate-200">
                  iOS Redmine Project URL
                </label>
                <span className="text-[11.5px] text-slate-500 dark:text-[#8F97A6]">
                  Default fallback active if empty
                </span>
              </div>
              <Input
                id="iosUrl"
                type="url"
                placeholder={PMS_PROJECT_URLS.ios}
                value={iosUrl}
                onChange={(e) => {
                  setIosUrl(e.target.value);
                  if (pmsErrors.ios) setPmsErrors((prev) => ({ ...prev, ios: null }));
                }}
                className={`bg-white dark:bg-[#080B12] border-slate-200 dark:border-[#1E2638] text-[13.5px] text-slate-900 dark:text-white h-10 px-3.5 placeholder:text-slate-400 dark:placeholder:text-[#525A6C] rounded-lg ${
                  pmsErrors.ios ? "border-red-500 focus:border-red-500" : "focus:border-purple-500 dark:focus:border-[#7c6cf6]"
                }`}
              />
              {pmsErrors.ios ? (
                <p className="text-[12px] text-red-500 dark:text-red-400">{pmsErrors.ios}</p>
              ) : (
                <p className="text-[11.5px] text-slate-500 dark:text-[#8F97A6] truncate font-mono">
                  Default: {PMS_PROJECT_URLS.ios}
                </p>
              )}
            </div>

            <Separator className="bg-slate-200 dark:bg-[#1A2234] my-2" />

            {/* Redmine API Access Key (for Project Members / Assignees) */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="pmsApiKey" className="text-[13px] font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                  <Key className="h-3.5 w-3.5 text-amber-500 dark:text-amber-400" />
                  Redmine API Access Key
                  <span className="text-[11.5px] font-normal text-slate-500 dark:text-[#8F97A6]">(Optional)</span>
                </label>
                <a
                  href="https://pms.optimumbrew.com/my/account"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11.5px] text-amber-600 dark:text-amber-400/90 hover:text-amber-700 dark:hover:text-amber-300 inline-flex items-center gap-1 hover:underline"
                >
                  Find your API key <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <div className="relative">
                <Input
                  id="pmsApiKey"
                  type={showPmsKey ? "text" : "password"}
                  placeholder="Paste your Redmine API access key here..."
                  value={pmsApiKey}
                  onChange={(e) => {
                    setPmsApiKey(e.target.value);
                    if (pmsConnection !== "idle") {
                      setPmsConnection("idle");
                      setPmsConnectionError(null);
                    }
                  }}
                  className="bg-white dark:bg-[#080B12] border-slate-200 dark:border-[#1E2638] text-[13.5px] text-slate-900 dark:text-white h-10 px-3.5 pr-10 placeholder:text-slate-400 dark:placeholder:text-[#525A6C] rounded-lg font-mono focus:border-purple-500 dark:focus:border-[#7c6cf6]"
                />
                <button
                  type="button"
                  onClick={() => setShowPmsKey(!showPmsKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-[#525A6C] hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                  title={showPmsKey ? "Hide API key" : "Show API key"}
                >
                  {showPmsKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-[11.5px] text-slate-500 dark:text-[#8F97A6]">
                Enables loading assignable project team members in BugDesk. Without an API key, issues default to &ldquo;Unassigned&rdquo;.
              </p>

              {/* Test PMS Connection Button & Status */}
              <div className="flex items-center gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleTestPMSConnection}
                  disabled={!pmsApiKey.trim() || pmsConnection === "testing"}
                  className="border-slate-200 dark:border-[#263248] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#1A2234] text-[12px] h-8 px-3 rounded-lg flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {pmsConnection === "testing" ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-600 dark:text-violet-400" />
                      Testing...
                    </>
                  ) : (
                    <>
                      <Repeat className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />
                      Test PMS Connection
                    </>
                  )}
                </Button>

                {pmsConnection === "connected" && (
                  <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 text-[11px] flex items-center gap-1 py-1 px-2 font-normal">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Connected{pmsConnectedUser ? ` as ${pmsConnectedUser}` : ""}
                  </Badge>
                )}

                {pmsConnection === "failed" && (
                  <Badge className="bg-rose-500/10 text-rose-500 dark:text-rose-400 border border-rose-500/30 text-[11px] flex items-center gap-1 py-1 px-2 font-normal">
                    <XCircle className="w-3.5 h-3.5" />
                    {pmsConnectionError || "Connection failed"}
                  </Badge>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 pt-2">
              <Button
                onClick={handleSavePMSUrls}
                className="btn-primary-gradient text-white font-bold text-[13.5px] h-9 px-4 rounded-lg shadow-sm flex items-center gap-1.5 cursor-pointer"
              >
                <Save className="h-4 w-4 text-white" />
                Save Configuration
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleResetPMSUrls}
                className="border-slate-200 dark:border-[#263248] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#1A2234] text-[13px] h-9 px-3.5 rounded-lg flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
                Reset to Defaults
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Device & OS Catalog (Globally Shared) */}
        <Card className="border-slate-200 bg-white dark:border-[#1A2234] dark:bg-[#0E131F] shadow-sm dark:shadow-none">
          <CardHeader className="border-b border-slate-200 dark:border-[#1A2234] pb-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle className="text-[16.5px] font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <Smartphone className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                    Device &amp; OS Catalog
                  </CardTitle>
                  <Badge variant="outline" className="border-violet-500/40 text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-transparent text-[11px] font-normal">
                    Shared Team Inventory
                  </Badge>
                </div>
                <CardDescription className="text-[13px] text-slate-500 dark:text-[#8F97A6] mt-1">
                  Centrally persisted inventory shared with your entire QA team. Selected devices append their name and OS version to bug titles (e.g. <span className="font-mono text-violet-600 dark:text-violet-400/90 text-[12px]">— OPPO CPH2729 OS 16</span>).
                </CardDescription>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleImportDevicesCSV}
                  accept=".csv"
                  className="hidden"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  className="border-slate-200 dark:border-[#263248] text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#1A2234] text-[12.5px] h-8.5 px-2.5 rounded-lg flex items-center gap-1.5"
                  title="Import devices from CSV"
                >
                  <Upload className="w-3.5 h-3.5 text-slate-400" />
                  Import CSV
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExportDevicesCSV}
                  className="border-slate-200 dark:border-[#263248] text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#1A2234] text-[12.5px] h-8.5 px-2.5 rounded-lg flex items-center gap-1.5"
                  title="Export devices to CSV"
                >
                  <Download className="w-3.5 h-3.5 text-slate-400" />
                  Export CSV
                </Button>
                <Button
                  size="sm"
                  onClick={handleOpenAddDevice}
                  className="btn-primary-gradient text-white font-bold text-[12.5px] h-8.5 px-3 rounded-lg flex items-center gap-1.5 shadow-sm"
                >
                  <Plus className="w-3.5 h-3.5 text-white" />
                  Add Device
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            {/* Search Filter Bar */}
            <div className="flex items-center justify-between gap-3">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-[#8F97A6]" />
                <Input
                  placeholder="Search devices or OS..."
                  value={devicesSearch}
                  onChange={(e) => setDevicesSearch(e.target.value)}
                  className="h-9 pl-9 bg-white dark:bg-[#080B12] border-slate-200 dark:border-[#1E2638] text-[13px] text-slate-900 dark:text-white rounded-lg placeholder:text-slate-400 dark:placeholder:text-[#525A6C]"
                />
              </div>
              <span className="text-[12px] text-slate-500 dark:text-[#8F97A6]">
                {devices.length} {devices.length === 1 ? "device" : "devices"} registered
              </span>
            </div>

            {/* Device List or States */}
            {devicesLoading ? (
              <div className="py-10 flex flex-col items-center justify-center gap-2 text-slate-400">
                <Loader2 className="w-5 h-5 animate-spin text-amber-500 dark:text-amber-400" />
                <span className="text-[13px] text-slate-500 dark:text-slate-400">Loading shared device catalog...</span>
              </div>
            ) : devicesError ? (
              <div className="p-4 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-500 dark:text-rose-400 text-[13px] flex items-center justify-between">
                <span>{devicesError}</span>
                <Button variant="outline" size="sm" onClick={fetchDevices} className="border-rose-500/30 hover:bg-rose-500/20 text-rose-500 dark:text-rose-300 h-7 text-[12px]">
                  Retry
                </Button>
              </div>
            ) : filteredDevices.length === 0 ? (
              <div className="py-10 border border-dashed border-slate-200 dark:border-[#1E2638] rounded-lg flex flex-col items-center justify-center text-center p-6 bg-slate-50/50 dark:bg-[#080B12]/50">
                <Smartphone className="w-8 h-8 text-slate-400 dark:text-[#525A6C] mb-2" />
                <p className="text-[13.5px] font-medium text-slate-700 dark:text-slate-200">
                  {devicesSearch ? "No matching devices found" : "No devices in shared catalog yet"}
                </p>
                <p className="text-[12.5px] text-slate-500 dark:text-[#8F97A6] max-w-md mt-1">
                  {devicesSearch
                    ? "Try adjusting your search terms."
                    : "Add devices here so any QA team member can select them on the New Bug form."}
                </p>
                {!devicesSearch && (
                  <Button
                    size="sm"
                    onClick={handleOpenAddDevice}
                    className="mt-3 btn-primary-gradient text-white font-bold text-[12.5px] h-8 px-3 rounded-lg shadow-sm"
                  >
                    <Plus className="w-3.5 h-3.5 mr-1 text-white" /> Add First Device
                  </Button>
                )}
              </div>
            ) : (
              <div className="border border-slate-200 dark:border-[#1A2234] rounded-lg divide-y divide-slate-200 dark:divide-[#1A2234] overflow-hidden bg-white dark:bg-[#080B12]">
                {filteredDevices.map((dev) => (
                  <div key={dev.id} className="p-3.5 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-[#0E131F]/70 transition-colors">
                    <div className="min-w-0 flex-1 pr-4">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-slate-900 dark:text-white text-[13.5px]">{dev.name}</span>
                        <Badge variant="outline" className="border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400 text-[11.5px] font-mono py-0 px-2">
                          {dev.os}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 text-[12px] text-slate-500 dark:text-[#8F97A6] mt-0.5">
                        {(dev.manufacturer || dev.model) && (
                          <span>
                            {[dev.manufacturer, dev.model].filter(Boolean).join(" • ")}
                          </span>
                        )}
                        {dev.created_at && (
                          <span className="text-slate-400 dark:text-[#525A6C]">
                            Added {new Date(dev.created_at).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleOpenEditDevice(dev)}
                        className="h-8 w-8 p-0 text-slate-500 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#1E2638] rounded-lg"
                        title="Edit device"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteDevice(dev)}
                        className="h-8 w-8 p-0 text-rose-500 dark:text-rose-400 hover:text-rose-600 dark:hover:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg"
                        title="Delete device"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Unified Authentication Account */}
        <Card className="border-slate-200 bg-white dark:border-[#1A2234] dark:bg-[#0E131F] shadow-sm dark:shadow-none">
          <CardHeader className="border-b border-slate-200 dark:border-[#1A2234] pb-4">
            <CardTitle className="text-[16.5px] font-bold text-slate-900 dark:text-white">Unified QA Platform Account</CardTitle>
            <CardDescription className="text-[13px] text-slate-500 dark:text-[#8F97A6]">Authentication is integrated with the Centralized QA Tools Platform.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-5 text-[13.5px]">
            <div className="flex items-center justify-between py-2.5 border-b border-slate-200 dark:border-[#1A2234]">
              <span className="text-slate-500 dark:text-[#8F97A6] font-medium">Logged in User:</span>
              <span className="font-semibold text-slate-900 dark:text-white">{session?.name || "QA Engineer"}</span>
            </div>
            <div className="flex items-center justify-between py-2.5 border-b border-slate-200 dark:border-[#1A2234]">
              <span className="text-slate-500 dark:text-[#8F97A6] font-medium">Email Address:</span>
              <span className="font-semibold text-slate-700 dark:text-slate-200">{session?.email || "N/A"}</span>
            </div>
            <div className="flex items-center justify-between py-2.5 border-b border-slate-200 dark:border-[#1A2234]">
              <span className="text-slate-500 dark:text-[#8F97A6] font-medium">Data Partition:</span>
              <span className="font-mono text-violet-600 dark:text-violet-400 text-[12.5px]">qabr:{session?.userId || "user"}:*</span>
            </div>
            <div className="flex items-center justify-between py-2.5">
              <span className="text-slate-500 dark:text-[#8F97A6] font-medium">Security State:</span>
              <span className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-semibold">
                <ShieldCheck className="w-4 h-4" /> HttpOnly Authenticated Session
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <SwitchModuleDialog
        open={switchOpen}
        onOpenChange={setSwitchOpen}
        initial={settings}
        onSave={update}
      />

      <DriveFolderSelectorModal
        isOpen={folderPickerOpen}
        onClose={() => setFolderPickerOpen(false)}
        initialFolderId={defaultFolder?.id || 'root'}
        initialFolderName={defaultFolder?.name || 'My Drive'}
        onSelectFolder={async (selected) => {
          try {
            const folderName = selected.name || selected.path || 'Folder';
            await api.setDriveDefaultFolder(selected.id, folderName);
            setDefaultFolder({ id: selected.id, name: folderName });
            setFolderUnavailable(false);
            setFolderPickerOpen(false);
            toast.success(`Default recording folder set to "${folderName}"`);
          } catch (err) {
            toast.error(err.message || 'Failed to update default folder');
          }
        }}
      />

      {/* Add / Edit Device Dialog */}
      <Dialog open={deviceModalOpen} onOpenChange={setDeviceModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[16.5px] font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-violet-600 dark:text-violet-400" />
              {editingDevice ? "Edit Catalog Device" : "Add Device to Shared Catalog"}
            </DialogTitle>
            <DialogDescription className="text-[13px] text-slate-500 dark:text-[#8F97A6]">
              {editingDevice
                ? "Update device details. Changes will be reflected for all team members."
                : "Register a device and OS version to make it selectable across the team."}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveDevice} className="space-y-3.5 py-2">
            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-slate-700 dark:text-slate-200">
                Device Display Name <span className="text-amber-500 dark:text-amber-400">*</span>
              </label>
              <Input
                placeholder="e.g. OPPO CPH2729 or Google Pixel 8"
                value={deviceForm.name}
                onChange={(e) => setDeviceForm((prev) => ({ ...prev, name: e.target.value }))}
                className="h-9.5 bg-white dark:bg-[#080B12] border-slate-200 dark:border-[#1E2638] text-[13.5px] text-slate-900 dark:text-white"
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-slate-700 dark:text-slate-200">
                OS Display / Version <span className="text-amber-500 dark:text-amber-400">*</span>
              </label>
              <Input
                placeholder="e.g. Android 16 or iOS 18.2"
                value={deviceForm.os}
                onChange={(e) => setDeviceForm((prev) => ({ ...prev, os: e.target.value }))}
                className="h-9.5 bg-white dark:bg-[#080B12] border-slate-200 dark:border-[#1E2638] text-[13.5px] text-slate-900 dark:text-white"
              />
              <span className="text-[11.5px] text-slate-500 dark:text-[#8F97A6]">
                Appends as &ldquo;OS 16&rdquo; (or iOS 18.2) to bug titles.
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <div className="space-y-1.5">
                <label className="text-[12.5px] font-medium text-slate-700 dark:text-slate-300">
                  Manufacturer <span className="text-slate-400 dark:text-[#8F97A6] font-normal">(optional)</span>
                </label>
                <Input
                  placeholder="e.g. OPPO"
                  value={deviceForm.manufacturer}
                  onChange={(e) => setDeviceForm((prev) => ({ ...prev, manufacturer: e.target.value }))}
                  className="h-9 bg-white dark:bg-[#080B12] border-slate-200 dark:border-[#1E2638] text-[13px] text-slate-900 dark:text-white"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[12.5px] font-medium text-slate-700 dark:text-slate-300">
                  Model <span className="text-slate-400 dark:text-[#8F97A6] font-normal">(optional)</span>
                </label>
                <Input
                  placeholder="e.g. CPH2729"
                  value={deviceForm.model}
                  onChange={(e) => setDeviceForm((prev) => ({ ...prev, model: e.target.value }))}
                  className="h-9 bg-white dark:bg-[#080B12] border-slate-200 dark:border-[#1E2638] text-[13px] text-slate-900 dark:text-white"
                />
              </div>
            </div>

            {deviceFormError && (
              <p className="text-[12.5px] text-rose-500 dark:text-rose-400 bg-rose-500/10 border border-rose-500/30 p-2 rounded">
                {deviceFormError}
              </p>
            )}

            <DialogFooter className="pt-3 gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDeviceModalOpen(false)}
                className="border-slate-200 dark:border-[#263248] text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#1A2234] text-[13px] h-9"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isSavingDevice}
                className="btn-primary-gradient text-white font-bold text-[13px] h-9 shadow-sm"
              >
                {isSavingDevice && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />}
                {editingDevice ? "Save Changes" : "Add Device"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default BugDeskSettings;
