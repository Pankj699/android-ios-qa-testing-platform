import * as React from "react";
import { Eye, EyeOff, Loader2, CheckCircle2, XCircle, Repeat, Save, ShieldCheck, HardDrive, Folder, RotateCcw, AlertCircle, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "../components/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { Separator } from "../components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { SwitchModuleDialog } from "../components/SwitchModuleDialog";
import DriveFolderSelectorModal from "../../components/DriveFolderSelectorModal";
import { api } from "../../services/api";
import { useAuth } from "../context/auth-context";
import { useModuleSettings } from "../hooks/use-module-settings";
import { getAISettings, saveAISettings, getPMSUrls, savePMSUrls } from "../lib/scoped-storage";
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

  // PMS / Redmine Integration settings
  const [androidUrl, setAndroidUrl] = React.useState("");
  const [iosUrl, setIosUrl] = React.useState("");
  const [pmsErrors, setPmsErrors] = React.useState({ android: null, ios: null });

  React.useEffect(() => {
    if (!session?.userId) return;
    const ai = getAISettings(session.userId);
    setApiKey(ai.apiKey || "");
    setModel(ai.model || "gemini-2.5-flash");

    // Load PMS / Redmine configured URLs
    const pms = getPMSUrls(session.userId);
    setAndroidUrl(pms.android || "");
    setIosUrl(pms.ios || "");

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
    toast.success("PMS / Redmine configuration saved.");
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

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Configure your Gemini AI connection, project module context, and workspace account."
      />

      <div className="max-w-4xl space-y-6 px-8 pb-8">
        {/* Gemini API Key */}
        <Card className="border-[#1A2234] bg-[#0E131F]">
          <CardHeader className="border-b border-[#1A2234] pb-4">
            <CardTitle className="text-[16.5px] font-bold text-white">Gemini API Key</CardTitle>
            <CardDescription className="text-[13px] text-[#8F97A6]">
              Stored locally in this browser, securely scoped to your account.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-5">
            <div className="space-y-1.5">
              <label htmlFor="apiKey" className="text-[13px] font-semibold text-slate-200">
                API Key
              </label>
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
                  className="h-10 pr-10 bg-[#080B12] border-[#1E2638] text-[13.5px] font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((s) => !s)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8F97A6] hover:text-white"
                  aria-label={showKey ? "Hide API key" : "Show API key"}
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[13px] font-semibold text-slate-200">Gemini Model</label>
              <Select value={model} onValueChange={(v) => setModel(v)}>
                <SelectTrigger className="h-10 bg-[#080B12] border-[#1E2638] text-[13.5px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#0E131F] border-[#1A2234] text-[13.5px]">
                  {GEMINI_MODELS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Button onClick={handleSaveKey} className="h-10 bg-[#F59E0B] hover:bg-[#E58E00] text-[#0A0D14] font-bold text-[13.5px]">
                <Save className="h-4 w-4 mr-1.5" /> Save API Key
              </Button>
              <Button
                variant="outline"
                onClick={handleTestConnection}
                disabled={connection === "testing"}
                className="h-10 border-[#263248] text-slate-200 hover:bg-[#1A2234] text-[13.5px]"
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
              <p className="text-[13px] text-rose-400 mt-1">{connectionError}</p>
            )}
          </CardContent>
        </Card>

        {/* Project Context */}
        <Card className="border-[#1A2234] bg-[#0E131F]">
          <CardHeader className="border-b border-[#1A2234] pb-4">
            <CardTitle className="text-[16.5px] font-bold text-white">Project Context</CardTitle>
            <CardDescription className="text-[13px] text-[#8F97A6]">Used to build the heading line and metadata on every generated report.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-5">
            <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
              <div className="p-3.5 rounded-lg bg-[#080B12] border border-[#1A2234]">
                <p className="text-[11px] text-[#8F97A6] uppercase tracking-wider font-semibold">Project</p>
                <p className="font-semibold text-white mt-1 truncate text-[14px]">{settings?.project ?? "Not configured"}</p>
              </div>
              <div className="p-3.5 rounded-lg bg-[#080B12] border border-[#1A2234]">
                <p className="text-[11px] text-[#8F97A6] uppercase tracking-wider font-semibold">Module</p>
                <p className="font-semibold text-white mt-1 truncate text-[14px]">{settings?.module ?? "Not configured"}</p>
              </div>
              <div className="p-3.5 rounded-lg bg-[#080B12] border border-[#1A2234]">
                <p className="text-[11px] text-[#8F97A6] uppercase tracking-wider font-semibold">Round</p>
                {settings?.round && settings.round.trim() ? (
                  <p className="font-mono font-semibold text-amber-400 mt-1 text-[14px] truncate">{settings.round.trim()}</p>
                ) : (
                  <p className="text-[#8F97A6] mt-1 text-[13.5px] italic">Not set (Optional)</p>
                )}
              </div>
            </div>
            <div className="pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSwitchOpen(true)}
                className="h-10 border-[#263248] text-slate-200 hover:bg-[#1A2234] text-[13.5px]"
              >
                <Repeat className="h-4 w-4 mr-2 text-amber-400" /> Switch Module / Round
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Recording & Attachments (Google Drive Integration) */}
        <Card className="border-[#1A2234] bg-[#0E131F]">
          <CardHeader className="border-b border-[#1A2234] pb-4">
            <CardTitle className="text-[16.5px] font-bold text-white">Recording &amp; Attachments</CardTitle>
            <CardDescription className="text-[13px] text-[#8F97A6]">
              Configure your Google Drive destination folder for automated BugDesk screen recordings.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-5">
            {/* Drive Connection Status */}
            <div className="flex items-center justify-between p-3.5 rounded-lg bg-[#080B12] border border-[#1A2234]">
              <div>
                <p className="text-[11px] text-[#8F97A6] uppercase tracking-wider font-semibold">Google Drive Connection</p>
                <p className="text-[13.5px] font-semibold text-white mt-0.5">
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
                <Badge variant="outline" className="gap-1.5 py-1.5 px-3 text-[12px] border-amber-500/30 text-amber-400 bg-amber-500/10">
                  Not Connected
                </Badge>
              )}
            </div>

            {/* Default Recording Folder */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[13px] font-semibold text-slate-200">
                  Default Recording Folder
                </label>
                {defaultFolder?.id && defaultFolder.id !== 'root' && (
                  <button
                    type="button"
                    onClick={handleRefreshFolderMetadata}
                    disabled={folderRefreshing || !driveStatus?.connected}
                    title="Refresh folder name and status from Google Drive"
                    className="text-[11.5px] text-[#8F97A6] hover:text-amber-400 flex items-center gap-1 transition-colors disabled:opacity-40"
                  >
                    <RotateCcw className={`w-3 h-3 ${folderRefreshing ? 'animate-spin text-amber-400' : ''}`} />
                    <span>{folderRefreshing ? 'Refreshing...' : 'Refresh'}</span>
                  </button>
                )}
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-lg bg-[#080B12] border border-[#1A2234]">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                    folderUnavailable
                      ? 'bg-red-500/10 border border-red-500/20 text-red-400'
                      : 'bg-amber-500/10 border border-amber-500/20 text-amber-400'
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
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
                        <span className="text-[13px] text-[#8F97A6]">Loading folder...</span>
                      </div>
                    ) : folderUnavailable ? (
                      <div className="min-w-0">
                        <p className="font-semibold text-red-400 text-[13.5px] truncate">
                          Folder unavailable
                        </p>
                        <p className="text-[11.5px] text-[#8F97A6] truncate">
                          The configured folder is missing or inaccessible in Google Drive.
                        </p>
                      </div>
                    ) : (
                      <div className="min-w-0">
                        <p
                          className="font-semibold text-white text-[13.5px] truncate"
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
                  className="h-9 border-[#263248] text-slate-200 hover:bg-[#1A2234] text-[13px] shrink-0"
                >
                  <Folder className="h-3.5 w-3.5 mr-1.5 text-amber-400" />
                  {defaultFolder?.id && defaultFolder.id !== 'root' ? 'Change Folder' : 'Choose Folder'}
                </Button>
              </div>
              {!driveStatus?.connected && (
                <p className="text-[12px] text-amber-400/80">
                  Connect your Google Drive in the QA Platform sidebar to select a destination folder.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* PMS / Redmine Integration */}
        <Card className="border-[#1A2234] bg-[#0E131F]">
          <CardHeader className="border-b border-[#1A2234] pb-4">
            <CardTitle className="text-[16.5px] font-bold text-white flex items-center gap-2">
              <ExternalLink className="h-4 w-4 text-amber-400" />
              PMS / Redmine Integration
            </CardTitle>
            <CardDescription className="text-[13px] text-[#8F97A6]">
              Configure destination Redmine project URLs for automated issue creation with prefilled Subject and Description.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-5">
            {/* Android Project URL */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="androidUrl" className="text-[13px] font-semibold text-slate-200">
                  Android Redmine Project URL
                </label>
                <span className="text-[11.5px] text-[#8F97A6]">
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
                className={`bg-[#080B12] border-[#1E2638] text-[13.5px] h-10 px-3.5 placeholder:text-[#525A6C] rounded-lg ${
                  pmsErrors.android ? "border-red-500 focus:border-red-500" : "focus:border-[#F59E0B]"
                }`}
              />
              {pmsErrors.android ? (
                <p className="text-[12px] text-red-400">{pmsErrors.android}</p>
              ) : (
                <p className="text-[11.5px] text-[#8F97A6] truncate font-mono">
                  Default: {PMS_PROJECT_URLS.android}
                </p>
              )}
            </div>

            {/* iOS Project URL */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="iosUrl" className="text-[13px] font-semibold text-slate-200">
                  iOS Redmine Project URL
                </label>
                <span className="text-[11.5px] text-[#8F97A6]">
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
                className={`bg-[#080B12] border-[#1E2638] text-[13.5px] h-10 px-3.5 placeholder:text-[#525A6C] rounded-lg ${
                  pmsErrors.ios ? "border-red-500 focus:border-red-500" : "focus:border-[#F59E0B]"
                }`}
              />
              {pmsErrors.ios ? (
                <p className="text-[12px] text-red-400">{pmsErrors.ios}</p>
              ) : (
                <p className="text-[11.5px] text-[#8F97A6] truncate font-mono">
                  Default: {PMS_PROJECT_URLS.ios}
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 pt-2">
              <Button
                onClick={handleSavePMSUrls}
                className="bg-[#F59E0B] hover:bg-[#E58E00] text-[#0A0D14] font-bold text-[13.5px] h-9 px-4 rounded-lg shadow-sm flex items-center gap-1.5 cursor-pointer"
              >
                <Save className="h-4 w-4 text-[#0A0D14]" />
                Save Configuration
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleResetPMSUrls}
                className="border-[#263248] text-slate-200 hover:bg-[#1A2234] text-[13px] h-9 px-3.5 rounded-lg flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5 text-amber-400" />
                Reset to Defaults
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Unified Authentication Account */}
        <Card className="border-[#1A2234] bg-[#0E131F]">
          <CardHeader className="border-b border-[#1A2234] pb-4">
            <CardTitle className="text-[16.5px] font-bold text-white">Unified QA Platform Account</CardTitle>
            <CardDescription className="text-[13px] text-[#8F97A6]">Authentication is integrated with the Centralized QA Tools Platform.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-5 text-[13.5px]">
            <div className="flex items-center justify-between py-2.5 border-b border-[#1A2234]">
              <span className="text-[#8F97A6] font-medium">Logged in User:</span>
              <span className="font-semibold text-white">{session?.name || "QA Engineer"}</span>
            </div>
            <div className="flex items-center justify-between py-2.5 border-b border-[#1A2234]">
              <span className="text-[#8F97A6] font-medium">Email Address:</span>
              <span className="font-semibold text-slate-200">{session?.email || "N/A"}</span>
            </div>
            <div className="flex items-center justify-between py-2.5 border-b border-[#1A2234]">
              <span className="text-[#8F97A6] font-medium">Data Partition:</span>
              <span className="font-mono text-amber-400 text-[12.5px]">qabr:{session?.userId || "user"}:*</span>
            </div>
            <div className="flex items-center justify-between py-2.5">
              <span className="text-[#8F97A6] font-medium">Security State:</span>
              <span className="flex items-center gap-2 text-emerald-400 font-semibold">
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
    </div>
  );
}

export default BugDeskSettings;
