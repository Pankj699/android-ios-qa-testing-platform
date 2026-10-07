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

export default function TestHistoryPage() {
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
  }, [filterResult]);

  const handleSearch = (e) => {
    e.preventDefault();
    fetchHistory();
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
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <History className="w-5 h-5 text-[#F59E0B]" />
            Play Asset Delivery Test Execution History
          </h2>
          <p className="text-xs text-slate-400">
            View historical test runs, device configurations, execution timelines, and full logcat dumps.
          </p>
        </div>

        <button
          onClick={fetchHistory}
          disabled={loading}
          className="p-2 rounded-lg bg-[#131924] border border-[#1E2638] hover:bg-[#1E2638] text-slate-300 hover:text-white transition-colors"
          title="Refresh History"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Filter Bar */}
      <div className="p-4 rounded-xl bg-[#131924] border border-[#1E2638] flex flex-wrap items-center justify-between gap-4">
        <form onSubmit={handleSearch} className="flex items-center gap-2 flex-1 max-w-md">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search by package, device, or ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#0A0D14] border border-[#1E2638] text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#F59E0B]"
            />
          </div>
          <button
            type="submit"
            className="px-3.5 py-2 rounded-lg bg-[#1E2638] hover:bg-[#263248] text-xs font-medium text-slate-200 border border-[#334155] transition-colors"
          >
            Search
          </button>
        </form>

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Filter Result:</span>
          <select
            value={filterResult}
            onChange={(e) => setFilterResult(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-[#0A0D14] border border-[#1E2638] text-xs text-slate-200 focus:outline-none focus:border-[#F59E0B]"
          >
            <option value="">All Results</option>
            <option value="PASS">PASS Only</option>
            <option value="FAIL">FAIL Only</option>
          </select>
        </div>
      </div>

      {/* History Table */}
      <div className="bg-[#131924] border border-[#1E2638] rounded-xl overflow-hidden">
        {history.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-[#0D111A] text-slate-400 uppercase text-[10px] font-semibold tracking-wider border-b border-[#1E2638]">
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
              <tbody className="divide-y divide-[#1E2638]/60">
                {history.map((t) => (
                  <tr key={t.id} className="hover:bg-[#1E2638]/40 transition-colors">
                    <td className="py-3 px-4 text-slate-400 font-mono text-[11px]">
                      {new Date(t.createdAt).toLocaleString()}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-white truncate max-w-[200px]" title={t.fileName || t.packageName}>{t.fileName || t.packageName || 'App'}</div>
                      <div className="text-[10px] text-slate-400 font-mono">{t.packageName} (ID: {t.id?.substring(0, 6)})</div>
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-300">{t.version || '1.0'}</td>
                    <td className="py-3 px-4 font-medium text-slate-200">{t.deviceName || t.deviceSerial}</td>
                    <td className="py-3 px-4 text-slate-400">{t.androidVersion || 'Android'}</td>
                    <td className="py-3 px-4 text-slate-300">{t.installMode || 'Fresh Install'}</td>
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
                    <td className="py-3 px-4 font-mono text-slate-300">{t.duration || '-'}</td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => handleOpenTest(t)}
                          className="p-1.5 rounded-lg bg-[#0A0D14] border border-[#1E2638] hover:bg-[#1E2638] text-slate-300 hover:text-white transition-colors"
                          title="View Test Details"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDownloadLog(t.id)}
                          className="p-1.5 rounded-lg bg-[#0A0D14] border border-[#1E2638] hover:bg-[#1E2638] text-slate-300 hover:text-white transition-colors"
                          title="Download Test Logs"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(t.id)}
                          className="p-1.5 rounded-lg bg-[#0A0D14] border border-[#1E2638] hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition-colors"
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
          <div className="p-12 text-center text-slate-400 space-y-2">
            <FileText className="w-8 h-8 text-slate-600 mx-auto" />
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
