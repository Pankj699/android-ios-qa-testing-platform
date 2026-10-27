import React, { useState, useEffect } from 'react';
import {
  History,
  Search,
  CheckCircle2,
  XCircle,
  Clock,
  Download,
  Trash2,
  Eye,
  RefreshCw,
  FileText
} from 'lucide-react';
import TestResultModal from '../components/TestResultModal';
import { api } from '../services/api';
import { socketService } from '../services/socket';
import { formatDeviceDisplayName, formatDeviceOsVersion } from '../utils/deviceFormatter';
import DeviceThumbnail from '../components/DeviceThumbnail';
import BuildThumbnail from '../components/BuildThumbnail';
import CustomSelect from '../components/ui/select';
import { toast } from '../utils/toast';

export default function TestHistoryPage({ currentUser }) {
  const [history, setHistory] = useState([]);
  const [filterResult, setFilterResult] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedTest, setSelectedTest] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);

  const fetchHistory = async () => {
    setLoading(true);
    try {
      const res = await api.getTestHistory({
        result: filterResult || undefined,
        search: searchQuery || undefined
      });
      setHistory(res.history || []);
    } catch (err) {
      console.error('Failed to load history:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, [filterResult, currentUser?.id]);

  // Real-time synchronization when a test completes, history updates, or a record is deleted
  useEffect(() => {
    const unsubUpdate = socketService.on('TEST_HISTORY_UPDATED', () => {
      fetchHistory();
    });
    const unsubFinish = socketService.on('TEST_FINISHED', () => {
      fetchHistory();
    });
    const unsubDelete = socketService.on('TEST_DELETED', () => {
      fetchHistory();
    });
    return () => {
      if (typeof unsubUpdate === 'function') unsubUpdate();
      if (typeof unsubFinish === 'function') unsubFinish();
      if (typeof unsubDelete === 'function') unsubDelete();
    };
  }, [filterResult, searchQuery]);

  const handleSearch = (e) => {
    e.preventDefault();
    fetchHistory();
  };

  const handleSearchChange = (e) => {
    const val = e.target.value;
    setSearchQuery(val);
    if (val === '') {
      api.getTestHistory({
        result: filterResult || undefined
      }).then(res => setHistory(res.history || [])).catch(() => {});
    }
  };

  const handleDelete = async (id) => {
    if (window.confirm('Are you sure you want to delete this test run record?')) {
      try {
        await api.deleteTest(id);
        fetchHistory();
        toast.success('Test run record deleted successfully.');
      } catch (err) {
        console.error('Failed to delete test:', err);
        toast.error(err.message || 'Failed to delete test run record.');
      }
    }
  };

  const handleOpenTest = (test) => {
    setSelectedTest(test);
    setModalOpen(true);
  };

  const handleDownloadLog = (id) => {
    window.open(`/api/test/${id}/download-logs`, '_blank');
  };

  return (
    <div className="space-y-6 fade-in">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-[var(--line)]">
        <div className="flex items-center gap-3.5">
          <div className="brand-mark w-10 h-10 rounded-2xl flex items-center justify-center text-white font-bold shrink-0 shadow-brand">
            <History className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-[26px] font-extrabold text-[#1F2544] dark:text-white tracking-tight flex items-center gap-2.5 font-sans">
              Test Execution <span className="text-heading-gradient">History</span>
            </h1>
            <p className="text-xs sm:text-[13px] text-[#6B7194] dark:text-[#94A3B8] mt-1">
              View historical test runs, device configurations, execution timelines, and full logcat dumps.
            </p>
          </div>
        </div>

        <button
          onClick={fetchHistory}
          disabled={loading}
          className="p-2.5 rounded-btn btn-soft text-[#6B7194] hover:text-[#1F2544] dark:text-slate-300 dark:hover:text-white transition-colors cursor-pointer"
          title="Refresh History"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Filter Bar */}
      <div className="p-4 rounded-card glass border border-[var(--line)] shadow-glass flex flex-wrap items-center justify-between gap-4">
        <form onSubmit={handleSearch} className="flex items-center gap-2 flex-1 max-w-md">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-[#6B7194] absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search by package, device, or ID..."
              value={searchQuery}
              onChange={handleSearchChange}
              className="w-full pl-9 pr-3.5 py-2 rounded-xl bg-white/70 border border-[var(--line)] text-xs text-[#1F2544] placeholder-[#6B7194] dark:bg-[#080B10] dark:border-[#1C2230] dark:text-white focus:outline-none focus:border-[#7c6cf6] focus:ring-2 focus:ring-[#7c6cf6]/20 shadow-xs"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 rounded-btn btn-soft text-xs font-bold text-[#1F2544] dark:text-[#CBD5E1] transition-colors cursor-pointer"
          >
            Search
          </button>
        </form>

        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-[#6B7194] dark:text-[#94A3B8]">Filter Result:</span>
          <CustomSelect
            value={filterResult}
            onChange={(val) => {
              const res = val?.target ? val.target.value : val;
              setFilterResult(res);
            }}
            options={[
              { value: '', label: 'All Results' },
              { value: 'PASS', label: 'PASS Only' },
              { value: 'FAIL', label: 'FAIL Only' }
            ]}
            className="h-9 w-36 text-xs font-medium rounded-xl"
            title="Filter Result"
          />
        </div>
      </div>

      {/* History Table */}
      <div className="glass rounded-card border border-[var(--line)] overflow-hidden shadow-glass">
        {history.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-[#1F2544] dark:text-slate-300">
              <thead className="bg-white/40 dark:bg-[#080B10]/80 text-[#6B7194] dark:text-[#94A3B8] uppercase text-[10px] font-bold tracking-wider border-b border-[var(--line)]">
                <tr>
                  <th className="py-3.5 px-4">Date / Time</th>
                  <th className="py-3.5 px-4">Application & Package</th>
                  <th className="py-3.5 px-4">Version</th>
                  <th className="py-3.5 px-4">Device</th>
                  <th className="py-3.5 px-4">Android</th>
                  <th className="py-3.5 px-4">Test Type</th>
                  <th className="py-3.5 px-4">Result</th>
                  <th className="py-3.5 px-4">Duration</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {history.map((t) => (
                  <tr key={t.id} className="hover:bg-[#7c6cf6]/5 dark:hover:bg-[#1C2230]/40 transition-colors">
                    <td className="py-3 px-4 text-[#6B7194] dark:text-[#94A3B8] font-mono text-[11px]">
                      {new Date(t.createdAt).toLocaleString()}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2.5">
                        <BuildThumbnail
                          iconUrl={t.iconUrl}
                          packageName={t.packageName}
                          applicationName={t.applicationName}
                          size="sm"
                        />
                        <div className="min-w-0">
                          <div className="font-bold text-[#1F2544] dark:text-white truncate max-w-[200px]" title={t.fileName || t.packageName}>{t.fileName || t.packageName || 'App'}</div>
                          <div className="text-[10px] text-[#6B7194] font-mono truncate max-w-[200px]">{t.packageName} (ID: {t.id?.substring(0, 6)})</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono text-[#1F2544] dark:text-[#CBD5E1]">{t.version || '1.0'}</td>
                    <td className="py-3 px-4 font-medium text-[#1F2544] dark:text-[#CBD5E1]">
                      <div className="flex items-center gap-1.5">
                        <DeviceThumbnail device={{ name: t.deviceName, serial: t.deviceSerial, osVersion: t.androidVersion || t.osVersion, platform: t.platform }} size="xs" />
                        <span className="font-semibold">{formatDeviceDisplayName({ name: t.deviceName, serial: t.deviceSerial, osVersion: t.androidVersion || t.osVersion, platform: t.platform })}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-[#6B7194] dark:text-[#94A3B8]">
                      {formatDeviceOsVersion({ name: t.deviceName, serial: t.deviceSerial, osVersion: t.androidVersion || t.osVersion, platform: t.platform }) || t.androidVersion || 'Android'}
                    </td>
                    <td className="py-3 px-4 text-[#1F2544] dark:text-[#CBD5E1] font-medium">{t.installMode || 'Fresh Install'}</td>
                    <td className="py-3 px-4">
                      {t.result === 'PASS' ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                          <CheckCircle2 className="w-3.5 h-3.5" /> PASS
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
                          <XCircle className="w-3.5 h-3.5" /> FAIL
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono text-[#1F2544] dark:text-[#CBD5E1]">{t.duration || '-'}</td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => handleOpenTest(t)}
                          className="p-1.5 rounded-lg btn-soft text-[#1F2544] dark:text-[#CBD5E1] hover:text-[#7c6cf6] transition-colors cursor-pointer"
                          title="View Test Details"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDownloadLog(t.id)}
                          className="p-1.5 rounded-lg btn-soft text-[#1F2544] dark:text-[#CBD5E1] hover:text-[#7c6cf6] transition-colors cursor-pointer"
                          title="Download Test Logs"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(t.id)}
                          className="p-1.5 rounded-lg btn-soft text-rose-500 hover:bg-rose-500/10 transition-colors cursor-pointer"
                          title="Delete History Entry"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-12 text-center text-[#6B7194] space-y-2">
            <FileText className="w-8 h-8 text-[#6B7194]/40 mx-auto" />
            <p className="text-xs font-medium">No matching test history records found.</p>
          </div>
        )}
      </div>

      {/* Test Result Drawer / Modal */}
      {modalOpen && selectedTest && (
        <TestResultModal
          test={selectedTest}
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  );
}
