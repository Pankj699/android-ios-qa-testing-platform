import React, { useState, useEffect, useRef } from 'react';
import {
  UserX,
  RefreshCw,
  AlertCircle,
  AlertTriangle,
  Info,
  Loader2,
  X
} from 'lucide-react';
import { api } from '../services/api';
import { toast } from 'sonner';
import { formatDeviceDisplayName } from '../utils/deviceFormatter';
import { useDialogShortcuts } from '../hooks/useDialogShortcuts';

export default function DeleteAppUserModal({
  isOpen,
  onClose,
  selectedDevice,
  onSuccess
}) {
  const [appUserForm, setAppUserForm] = useState({
    userId: '',
    appId: '2',
    deviceUuid: '',
    packageName: 'com.bg.flyermaker'
  });
  const [isEdited, setIsEdited] = useState({
    userId: false,
    appId: false,
    deviceUuid: false
  });
  const [detectedAppUser, setDetectedAppUser] = useState(null);
  const [loadingAppUser, setLoadingAppUser] = useState(false);
  const [submittingAppUser, setSubmittingAppUser] = useState(false);
  const submittingAppUserRef = useRef(false);
  const [clearLocalData, setClearLocalData] = useState(false);
  const [showRefreshConfirm, setShowRefreshConfirm] = useState(false);
  const [appUserError, setAppUserError] = useState(null);
  const [outcomeUnknown, setOutcomeUnknown] = useState(false);

  // Fetch app user identifiers from selected device
  const fetchAppUserIdentifiers = async (forceOverwrite = false) => {
    if (!selectedDevice || !selectedDevice.serial) return;
    setLoadingAppUser(true);
    setAppUserError(null);
    setOutcomeUnknown(false);
    try {
      const res = await api.getAppUser(selectedDevice.serial);
      setDetectedAppUser(res);

      const hasManualEdits = isEdited.userId || isEdited.appId || isEdited.deviceUuid;
      if (!hasManualEdits || forceOverwrite) {
        setAppUserForm({
          userId: res.userId ? String(res.userId) : '',
          appId: res.appId ? String(res.appId) : '2',
          deviceUuid: res.deviceUuid || '',
          packageName: res.packageName || 'com.bg.flyermaker'
        });
        setIsEdited({ userId: false, appId: false, deviceUuid: false });
        setShowRefreshConfirm(false);
      }
      if (!res.available && res.reason) {
        setAppUserError(res.reason);
      }
    } catch (err) {
      console.error('Failed to get app user from device:', err);
      setAppUserError(`Could not detect app user on device: ${err.message}`);
    } finally {
      setLoadingAppUser(false);
    }
  };

  // Reset & fetch when modal opens
  useEffect(() => {
    if (isOpen && selectedDevice) {
      fetchAppUserIdentifiers(true);
      setClearLocalData(false);
      setShowRefreshConfirm(false);
      setAppUserError(null);
      setOutcomeUnknown(false);
    }
  }, [isOpen, selectedDevice?.serial]);

  // Handle Refresh button click
  const handleRefreshClick = () => {
    const hasManualEdits = isEdited.userId || isEdited.appId || isEdited.deviceUuid;
    if (hasManualEdits) {
      setShowRefreshConfirm(true);
    } else {
      fetchAppUserIdentifiers(true);
    }
  };

  // Handle Confirm Delete App User
  const handleConfirmDelete = async () => {
    if (submittingAppUserRef.current || submittingAppUser || outcomeUnknown) return;
    if (!selectedDevice || !selectedDevice.serial) {
      setAppUserError('No active target device selected.');
      return;
    }

    const cleanUserId = (appUserForm.userId || '').trim();
    if (!cleanUserId || !/^\d+$/.test(cleanUserId) || parseInt(cleanUserId, 10) <= 0) {
      setAppUserError('User ID must be a valid positive integer.');
      return;
    }

    const cleanAppId = (appUserForm.appId || '').trim();
    if (!cleanAppId || !/^\d+$/.test(cleanAppId) || parseInt(cleanAppId, 10) <= 0) {
      setAppUserError('App ID must be a valid positive integer (default 2).');
      return;
    }

    const cleanDeviceUuid = (appUserForm.deviceUuid || '').trim();
    if (!cleanDeviceUuid) {
      setAppUserError('Device UUID is required.');
      return;
    }

    submittingAppUserRef.current = true;
    setSubmittingAppUser(true);
    setAppUserError(null);
    setOutcomeUnknown(false);

    try {
      const res = await api.deleteAppUser(selectedDevice.serial, {
        userId: parseInt(cleanUserId, 10),
        appId: parseInt(cleanAppId, 10),
        deviceUuid: cleanDeviceUuid,
        clearLocalData,
        packageName: appUserForm.packageName || 'com.bg.flyermaker'
      });

      const clearedMsg = res.localDataCleared ? ' and local app data was reset' : '';
      if (res.verifiedViaStatusCheck) {
        toast.success(`Credits removed successfully for User ID ${cleanUserId} (verified after delayed upstream response)${clearedMsg}.`);
      } else {
        toast.success(`Credits removed successfully for User ID ${cleanUserId}${clearedMsg}. (Account remains registered upstream)`);
      }
      if (onSuccess) {
        onSuccess(res);
      }
      onClose();
    } catch (err) {
      console.error('Delete app user request failed:', err);
      const isTimeoutOrUnknown = !!(err.outcomeUnknown || err.data?.outcomeUnknown || err.code === 'UPSTREAM_TIMEOUT' || err.status === 504);
      const detail = err.data?.error || err.upstreamData?.message || err.message;

      if (isTimeoutOrUnknown) {
        setOutcomeUnknown(true);
        setAppUserError(`Outcome unknown: The request timed out waiting for upstream response. The operation may have completed and credits may already be removed. Please verify credit balance in the app before retrying. Do not resubmit.`);
      } else {
        setOutcomeUnknown(false);
        setAppUserError(`Failed to remove credits: ${detail}`);
      }
    } finally {
      submittingAppUserRef.current = false;
      setSubmittingAppUser(false);
    }
  };

  // Global Dialog Keyboard Shortcuts: Nested overwrite confirmation
  useDialogShortcuts({
    isOpen: isOpen && showRefreshConfirm,
    onPrimaryAction: () => fetchAppUserIdentifiers(true),
    onSubmit: () => fetchAppUserIdentifiers(true),
    onClose: () => setShowRefreshConfirm(false),
    id: 'delete-app-user-overwrite-confirm'
  });

  // Global Dialog Keyboard Shortcuts: Main Delete App User Modal
  useDialogShortcuts({
    isOpen: isOpen && !showRefreshConfirm,
    onPrimaryAction: handleConfirmDelete,
    onSubmit: handleConfirmDelete,
    onClose: onClose,
    disabled: submittingAppUser || !selectedDevice || !appUserForm.userId.trim() || !appUserForm.deviceUuid.trim() || outcomeUnknown,
    loading: submittingAppUser,
    id: 'delete-app-user-modal'
  });

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-fadeIn"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-app-user-title"
    >
      <div className="w-full max-w-lg glass rounded-2xl shadow-2xl p-6 space-y-4 border border-[var(--line)] max-h-[90vh] overflow-y-auto">
        {/* Modal Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-500">
              <UserX className="w-5 h-5 text-rose-500" />
            </div>
            <div>
              <h3 id="delete-app-user-title" className="text-sm font-extrabold text-[#1F2544] dark:text-[#FFFFFF]">
                Delete App User / Remove Credits
              </h3>
              <p className="text-xs text-[#6B7194] dark:text-[#8F97A6]">
                Primary Device:{' '}
                {selectedDevice ? (
                  <>
                    <span className="font-semibold text-[#1F2544] dark:text-[#CBD5E1]">
                      {formatDeviceDisplayName(selectedDevice)}
                    </span>{' '}
                    [{selectedDevice.serial}]
                  </>
                ) : (
                  <span className="font-semibold text-rose-500">No device selected</span>
                )}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={submittingAppUser}
            className="p-1 rounded-lg text-[#6B7194] hover:text-[#1F2544] dark:text-[#8F97A6] dark:hover:text-white transition-colors cursor-pointer"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* API Contract Behavior Callout */}
        <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 text-xs text-amber-800 dark:text-amber-300 space-y-1">
          <div className="flex items-center gap-1.5 font-bold">
            <Info className="w-3.5 h-3.5 text-amber-500 shrink-0" />
            <span>Notice on Upstream API Behavior</span>
          </div>
          <p className="text-[11px] leading-relaxed opacity-90">
            The upstream endpoint (<code className="font-mono font-semibold">removeCredits</code>) resets credit balances and does <strong>not</strong> delete the cloud user account. This operation is labeled accurately and will not claim upstream account deletion.
          </p>
        </div>

        {/* Refresh Action & Warning Banner */}
        <div className="flex items-center justify-between pt-1">
          <span className="text-[11px] text-[#6B7194] dark:text-[#8F97A6]">
            Target App: <span className="font-mono text-[#7c6cf6] dark:text-[#F59E0B] font-semibold">{appUserForm.packageName || 'com.bg.flyermaker'}</span>
          </span>
          <button
            type="button"
            onClick={handleRefreshClick}
            disabled={loadingAppUser || submittingAppUser || !selectedDevice}
            className="flex items-center gap-1.5 text-xs font-bold text-[#7c6cf6] dark:text-[#F59E0B] hover:underline cursor-pointer disabled:opacity-50"
            title="Re-extract latest identifiers from the selected primary device"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingAppUser ? 'animate-spin' : ''}`} />
            <span>{loadingAppUser ? 'Detecting...' : 'Refresh Detected Values'}</span>
          </button>
        </div>

        {/* Overwrite Confirmation Warning */}
        {showRefreshConfirm && (
          <div className="p-3 rounded-xl bg-amber-500/15 border border-amber-500/30 text-xs text-amber-900 dark:text-amber-200 space-y-2 animate-fadeIn">
            <p className="font-semibold">
              You have modified one or more fields manually. Replace your manual changes with fresh values from the device?
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fetchAppUserIdentifiers(true)}
                className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition-all cursor-pointer"
              >
                Yes, Replace
              </button>
              <button
                type="button"
                onClick={() => setShowRefreshConfirm(false)}
                className="px-2.5 py-1 rounded-lg btn-soft text-xs font-bold text-[#1F2544] dark:text-[#CBD5E1] cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Editable Identifier Fields */}
        <div className="space-y-3.5">
          {/* Field 1: User ID */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-[#1F2544] dark:text-[#CBD5E1] flex items-center gap-1.5">
                <span>User ID</span>
              </label>
              {isEdited.userId ? (
                <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                  Manually edited
                </span>
              ) : detectedAppUser?.userId ? (
                <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                  Auto-detected
                </span>
              ) : (
                <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-500/10 px-2 py-0.5 rounded border border-slate-500/20">
                  Manual entry required
                </span>
              )}
            </div>
            <input
              type="text"
              value={appUserForm.userId}
              onChange={(e) => {
                const val = e.target.value;
                setAppUserForm(prev => ({ ...prev, userId: val }));
                setIsEdited(prev => ({ ...prev, userId: true }));
              }}
              disabled={submittingAppUser}
              placeholder="e.g. 2048596"
              className="w-full h-10 px-3 text-xs font-mono rounded-xl bg-white/70 border border-[var(--line)] text-[#1F2544] placeholder-[#6B7194] dark:bg-[#080B10] dark:border-[#1E2638] dark:text-white focus:outline-none focus:border-[#7c6cf6] focus:ring-1 focus:ring-[#7c6cf6]/50 shadow-xs"
            />
          </div>

          {/* Field 2: App ID */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-[#1F2544] dark:text-[#CBD5E1] flex items-center gap-1.5">
                <span>App ID (Default: 2)</span>
              </label>
              {isEdited.appId ? (
                <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                  Manually edited
                </span>
              ) : (
                <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-500/10 px-2 py-0.5 rounded border border-slate-500/20">
                  Default: 2
                </span>
              )}
            </div>
            <input
              type="text"
              value={appUserForm.appId}
              onChange={(e) => {
                const val = e.target.value;
                setAppUserForm(prev => ({ ...prev, appId: val }));
                setIsEdited(prev => ({ ...prev, appId: true }));
              }}
              disabled={submittingAppUser}
              placeholder="2"
              className="w-full h-10 px-3 text-xs font-mono rounded-xl bg-white/70 border border-[var(--line)] text-[#1F2544] placeholder-[#6B7194] dark:bg-[#080B10] dark:border-[#1E2638] dark:text-white focus:outline-none focus:border-[#7c6cf6] focus:ring-1 focus:ring-[#7c6cf6]/50 shadow-xs"
            />
          </div>

          {/* Field 3: Device UUID */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-[#1F2544] dark:text-[#CBD5E1] flex items-center gap-1.5">
                <span>Device UUID</span>
              </label>
              {isEdited.deviceUuid ? (
                <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                  Manually edited
                </span>
              ) : detectedAppUser?.deviceUuid ? (
                <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                  Auto-detected
                </span>
              ) : (
                <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-500/10 px-2 py-0.5 rounded border border-slate-500/20">
                  Manual entry required
                </span>
              )}
            </div>
            <input
              type="text"
              value={appUserForm.deviceUuid}
              onChange={(e) => {
                const val = e.target.value;
                setAppUserForm(prev => ({ ...prev, deviceUuid: val }));
                setIsEdited(prev => ({ ...prev, deviceUuid: true }));
              }}
              disabled={submittingAppUser}
              placeholder="e.g. cc06494c51fab615"
              className="w-full h-10 px-3 text-xs font-mono rounded-xl bg-white/70 border border-[var(--line)] text-[#1F2544] placeholder-[#6B7194] dark:bg-[#080B10] dark:border-[#1E2638] dark:text-white focus:outline-none focus:border-[#7c6cf6] focus:ring-1 focus:ring-[#7c6cf6]/50 shadow-xs"
            />
          </div>
        </div>

        {/* Optional Separate Action: Clear Local App Data */}
        <label className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-100/60 dark:bg-slate-900/60 border border-[var(--line)] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={clearLocalData}
            onChange={(e) => setClearLocalData(e.target.checked)}
            disabled={submittingAppUser}
            className="mt-0.5 accent-rose-600 rounded"
          />
          <div className="space-y-0.5">
            <span className="text-xs font-bold text-[#1F2544] dark:text-[#CBD5E1]">
              Also reset local app data on this device (adb shell pm clear)
            </span>
            <p className="text-[11px] text-[#6B7194] dark:text-[#94A3B8] leading-tight">
              Explicitly clears local cached preferences, databases, and guest credentials on this device.
            </p>
          </div>
        </label>

        {/* Outcome Unknown Alert Banner */}
        {outcomeUnknown && (
          <div className="p-3.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-900 dark:text-amber-200 text-xs space-y-1.5 animate-fadeIn">
            <div className="flex items-center gap-1.5 font-bold text-amber-700 dark:text-amber-400">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>Outcome Unknown — Action Timed Out</span>
            </div>
            <p className="text-[11px] leading-relaxed">
              The upstream service did not respond within the expected time limit, but the credit removal may have already completed.
              <strong> Do not retry or resubmit immediately.</strong> Please check the user balance directly in the app first.
            </p>
          </div>
        )}

        {/* Error Message Alert */}
        {appUserError && !outcomeUnknown && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs flex items-start gap-2 animate-fadeIn">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="leading-relaxed">{appUserError}</span>
          </div>
        )}

        {/* Modal Actions */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-[var(--line)]">
          <button
            type="button"
            onClick={onClose}
            disabled={submittingAppUser}
            className="px-4 py-2 rounded-btn btn-soft text-xs font-bold text-[#1F2544] dark:text-[#CBD5E1] cursor-pointer disabled:opacity-50"
          >
            {outcomeUnknown ? 'Close' : 'Cancel'}
          </button>

          {!outcomeUnknown && (
            <button
              type="button"
              onClick={handleConfirmDelete}
              disabled={submittingAppUser || !selectedDevice || !appUserForm.userId.trim() || !appUserForm.deviceUuid.trim()}
              className="flex items-center gap-2 px-4 py-2 rounded-btn text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 shadow-sm transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submittingAppUser ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Deleting app user...</span>
                </>
              ) : (
                <>
                  <UserX className="w-3.5 h-3.5" />
                  <span>Confirm Action</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
