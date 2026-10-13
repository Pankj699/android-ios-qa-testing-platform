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

  // Real-time synchronization when a test completes or is deleted
  useEffect(() => {
    const unsubFinish = socketService.on('TEST_FINISHED', () => {
      fetchHistory();
    });
    const unsubDelete = socketService.on('TEST_DELETED', () => {
      fetchHistory();
    });
    return () => {
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
      } catch (err) {
        console.error('Failed to delete test:', err);
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
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-[#1C2230]">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2.5">
            <History className="w-5 h-5 text-[#F59E0B]" />
            Play Asset Delivery Test Execution History
          </h2>
          <p className="text-xs text-[#94A3B8] mt-1">
            View historical test runs, device configurations, execution timelines, and full logcat dumps.
          </p>
        </div>

        <button
          onClick={fetchHistory}
          disabled={loading}
          className="p-2 rounded-lg bg-[#10131B] border border-[#1C2230] hover:bg-[#161B26] text-slate-300 hover:text-white transition-colors cursor-pointer"
          title="Refresh History"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Filter Bar */}
      <div className="p-4 rounded-xl bg-[#10131B] border border-[#1C2230] shadow-sm flex flex-wrap items-center justify-between gap-4">
        <form onSubmit={handleSearch} className="flex items-center gap-2 flex-1 max-w-md">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-[#64748B] absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search by package, device, or ID..."
              value={searchQuery}
              onChange={handleSearchChange}
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#080B10] border border-[#1C2230] text-xs text-white placeholder-[#64748B] focus:outline-none focus:border-[#F59E0B]"
            />
          </div>
          <button
            type="submit"
            className="px-3.5 py-2 rounded-lg bg-[#080B10] hover:bg-[#161B26] text-xs font-semibold text-[#CBD5E1] border border-[#1C2230] transition-colors cursor-pointer"
          >
            Search
          </button>
        </form>

        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#94A3B8]">Filter Result:</span>
          <select
            value={filterResult}
            onChange={(e) => setFilterResult(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-[#080B10] border border-[#1C2230] text-xs text-[#CBD5E1] focus:outline-none focus:border-[#F59E0B] cursor-pointer"
          >
            <option value="" className="bg-[#10131B]">All Results</option>
            <option value="PASS" className="bg-[#10131B]">PASS Only</option>
            <option value="FAIL" className="bg-[#10131B]">FAIL Only</option>
          </select>
        </div>
      </div>

      {/* History Table */}
      <div className="bg-[#10131B] border border-[#1C2230] rounded-xl overflow-hidden shadow-sm">
        {history.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-[#080B10] text-[#94A3B8] uppercase text-[10px] font-semibold tracking-wider border-b border-[#1C2230]">
                <tr>
                  <th className="py-3 px-4">Date / Time</th>
                  <th className="py-3 px-4">Application & Package</th>
                  <th className="py-3 px-4">Version</th>
                  <th className="py-3 px-4">Device</th>
                  <th className="py-3 px-4">Android</th>
                  <th className="py-3 px-4">Test Type</th>
                  <th className="py-3 px-4">Result</th>
                  <th className="py-3 px-4">Duration</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1C2230]">
                {history.map((t) => (
                  <tr key={t.id} className="hover:bg-[#1C2230]/40 transition-colors">
                    <td className="py-3 px-4 text-[#94A3B8] font-mono text-[11px]">
                      {new Date(t.createdAt).toLocaleString()}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-white truncate max-w-[200px]" title={t.fileName || t.packageName}>{t.fileName || t.packageName || 'App'}</div>
                      <div className="text-[10px] text-[#64748B] font-mono">{t.packageName} (ID: {t.id?.substring(0, 6)})</div>
                    </td>
                    <td className="py-3 px-4 font-mono text-[#CBD5E1]">{t.version || '1.0'}</td>
                    <td className="py-3 px-4 font-medium text-[#CBD5E1]">
                      <div className="flex items-center gap-1.5">
                        <DeviceThumbnail device={{ name: t.deviceName, serial: t.deviceSerial, osVersion: t.androidVersion || t.osVersion, platform: t.platform }} size="xs" />
                        <span>{formatDeviceDisplayName({ name: t.deviceName, serial: t.deviceSerial, osVersion: t.androidVersion || t.osVersion, platform: t.platform })}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-[#94A3B8]">
                      {formatDeviceOsVersion({ name: t.deviceName, serial: t.deviceSerial, osVersion: t.androidVersion || t.osVersion, platform: t.platform }) || t.androidVersion || 'Android'}
                    </td>
                    <td className="py-3 px-4 text-[#CBD5E1]">{t.installMode || 'Fresh Install'}</td>
                    <td className="py-3 px-4">
                      {t.result === 'PASS' ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          <CheckCircle2 className="w-3.5 h-3.5" /> PASS
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                          <XCircle className="w-3.5 h-3.5" /> FAIL
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono text-[#CBD5E1]">{t.duration || '-'}</td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => handleOpenTest(t)}
                          className="p-1.5 rounded-lg bg-[#080B10] border border-[#1C2230] hover:bg-[#161B26] text-[#CBD5E1] hover:text-white transition-colors cursor-pointer"
                          title="View Test Details"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDownloadLog(t.id)}
                          className="p-1.5 rounded-lg bg-[#080B10] border border-[#1C2230] hover:bg-[#161B26] text-[#CBD5E1] hover:text-white transition-colors cursor-pointer"
                          title="Download Test Logs"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(t.id)}
                          className="p-1.5 rounded-lg bg-[#080B10] border border-[#1C2230] hover:bg-rose-500/20 text-[#64748B] hover:text-rose-400 transition-colors cursor-pointer"
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
          <div className="p-12 text-center text-[#64748B] space-y-2">
            <FileText className="w-8 h-8 text-[#64748B]/50 mx-auto" />
            <p className="text-xs">No matching test history records found.</p>
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
