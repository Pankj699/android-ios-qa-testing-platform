import React, { useState, useEffect, useCallback } from 'react';
import {
  Users,
  ShieldCheck,
  ShieldAlert,
  Search,
  RefreshCw,
  Edit2,
  KeyRound,
  CheckCircle2,
  XCircle,
  UserCheck,
  UserX,
  Shield,
  Copy,
  Check,
  AlertTriangle,
  X
} from 'lucide-react';
import { api } from '../services/api';
import CustomSelect from '../components/ui/select';
import { toast } from '../utils/toast';

const ROLES = ['ADMIN', 'EDITOR', 'TESTER', 'DEVELOPER', 'VIEWER'];
const STATUSES = ['ACTIVE', 'INACTIVE'];

export default function AdminUsersPage({ currentUser }) {
  const [users, setUsers] = useState([]);
  const [summary, setSummary] = useState({ total: 0, active: 0, inactive: 0, administrators: 0 });
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Modals
  const [editModalUser, setEditModalUser] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', role: 'TESTER', status: 'ACTIVE' });
  const [editError, setEditError] = useState('');
  const [editLoading, setEditLoading] = useState(false);

  const [resetModalUser, setResetModalUser] = useState(null);
  const [resetCustomPassword, setResetCustomPassword] = useState('');
  const [resetResult, setResetResult] = useState(null);
  const [resetError, setResetError] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const showNotification = (msg, type = 'success') => {
    if (type === 'error') {
      toast.error(msg);
    } else {
      toast.success(msg);
    }
  };

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.adminGetUsers({
        search: searchQuery || undefined,
        role: roleFilter || undefined,
        status: statusFilter || undefined
      });
      setUsers(res.users || []);
      if (res.summary) setSummary(res.summary);
    } catch (err) {
      console.error('Failed to load users:', err);
      showNotification(err.message || 'Failed to load users', 'error');
    } finally {
      setLoading(false);
    }
  }, [searchQuery, roleFilter, statusFilter]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    loadUsers();
  };

  const openEditModal = (user) => {
    setEditModalUser(user);
    setEditForm({
      name: user.name || '',
      role: user.role || 'TESTER',
      status: user.status || 'ACTIVE'
    });
    setEditError('');
  };

  const handleSaveUser = async (e) => {
    e.preventDefault();
    if (!editModalUser) return;
    setEditLoading(true);
    setEditError('');
    try {
      await api.adminUpdateUser(editModalUser.id, editForm);
      showNotification(`User ${editModalUser.email} updated successfully.`);
      setEditModalUser(null);
      loadUsers();
    } catch (err) {
      setEditError(err.message || 'Failed to update user.');
    } finally {
      setEditLoading(false);
    }
  };

  const openResetModal = (user) => {
    setResetModalUser(user);
    setResetCustomPassword('');
    setResetResult(null);
    setResetError('');
    setCopied(false);
  };

  const handleExecuteReset = async (e) => {
    e.preventDefault();
    if (!resetModalUser) return;
    setResetLoading(true);
    setResetError('');
    try {
      const res = await api.adminResetPassword(
        resetModalUser.id,
        resetCustomPassword.trim() ? resetCustomPassword.trim() : null
      );
      setResetResult(res.temporaryPassword);
      showNotification(`Password for ${resetModalUser.email} reset successfully.`);
    } catch (err) {
      setResetError(err.message || 'Failed to reset password.');
    } finally {
      setResetLoading(false);
    }
  };

  const handleCopyPassword = () => {
    if (!resetResult) return;
    navigator.clipboard.writeText(resetResult);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  const getRoleBadgeStyle = (role) => {
    switch ((role || '').toUpperCase()) {
      case 'ADMIN':
        return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
      case 'EDITOR':
        return 'bg-purple-500/10 text-purple-400 border-purple-500/30';
      case 'TESTER':
        return 'bg-blue-500/10 text-blue-400 border-blue-500/30';
      case 'DEVELOPER':
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
      case 'VIEWER':
      default:
        return 'bg-slate-500/10 text-slate-400 border-slate-500/30';
    }
  };

  return (
    <div className="space-y-6 fade-in text-slate-800 dark:text-slate-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-[var(--line)]">
        <div className="flex items-center gap-3">
          <div className="brand-mark w-10 h-10 rounded-2xl flex items-center justify-center text-white font-bold shrink-0 shadow-brand">
            <ShieldCheck className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl sm:text-[26px] font-extrabold text-[#1F2544] dark:text-white tracking-tight font-sans">
                User Management &amp; Access <span className="text-heading-gradient">Control</span>
              </h1>
              <span className="chip-badge uppercase text-[10px] tracking-wider font-bold text-violet-600 dark:text-violet-300 bg-violet-500/10 border-violet-500/20">
                Admin
              </span>
            </div>
            <p className="text-xs sm:text-[13px] text-[#6B7194] dark:text-[#94A3B8] mt-1">
              Manage platform users, assign role-based permissions (RBAC), control account status, and perform admin password resets.
            </p>
          </div>
        </div>

        <button
          onClick={loadUsers}
          disabled={loading}
          className="p-2.5 rounded-pill glass border border-[var(--line)] text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-all shadow-sm hover:border-violet-500/40"
          title="Refresh Users"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="p-5 rounded-card glass border border-[var(--line)] shadow-sm hover:border-violet-500/30 transition-all">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs mb-2 font-semibold">
            <span>Total Accounts</span>
            <Users className="w-4 h-4 text-violet-500" />
          </div>
          <div className="text-2xl font-extrabold text-slate-900 dark:text-white font-mono">{summary.total}</div>
        </div>

        <div className="p-5 rounded-card glass border border-[var(--line)] shadow-sm hover:border-violet-500/30 transition-all">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs mb-2 font-semibold">
            <span>Active Users</span>
            <UserCheck className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400 font-mono">{summary.active}</div>
        </div>

        <div className="p-5 rounded-card glass border border-[var(--line)] shadow-sm hover:border-violet-500/30 transition-all">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs mb-2 font-semibold">
            <span>Inactive Users</span>
            <UserX className="w-4 h-4 text-rose-500" />
          </div>
          <div className="text-2xl font-extrabold text-rose-600 dark:text-rose-400 font-mono">{summary.inactive}</div>
        </div>

        <div className="p-5 rounded-card glass border border-[var(--line)] shadow-sm hover:border-violet-500/30 transition-all">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs mb-2 font-semibold">
            <span>Administrators</span>
            <Shield className="w-4 h-4 text-violet-500" />
          </div>
          <div className="text-2xl font-extrabold text-violet-600 dark:text-violet-400 font-mono">{summary.administrators}</div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="p-4 rounded-card glass border border-[var(--line)] shadow-sm flex flex-wrap items-center justify-between gap-4">
        <form onSubmit={handleSearchSubmit} className="flex items-center gap-2 flex-1 max-w-md">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-2.5" />
            <input
              type="text"
              placeholder="Search by name or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9.5 pr-3 py-2 rounded-pill bg-white/80 dark:bg-slate-950/60 border border-[var(--line)] text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-violet-500 shadow-inner transition-all"
            />
          </div>
          <button
            type="submit"
            className="btn-magic px-4 py-2 rounded-pill text-xs font-bold text-white shadow-md transition-all cursor-pointer"
          >
            Search
          </button>
        </form>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 dark:text-slate-400 font-semibold">Role:</span>
            <CustomSelect
              value={roleFilter}
              onChange={(val) => setRoleFilter(val?.target ? val.target.value : val)}
              options={[
                { value: '', label: 'All Roles' },
                ...ROLES.map((r) => ({ value: r, label: r }))
              ]}
              className="h-8 w-32 text-xs rounded-pill"
              title="Filter by Role"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 dark:text-slate-400 font-semibold">Status:</span>
            <CustomSelect
              value={statusFilter}
              onChange={(val) => setStatusFilter(val?.target ? val.target.value : val)}
              options={[
                { value: '', label: 'All Statuses' },
                ...STATUSES.map((s) => ({ value: s, label: s }))
              ]}
              className="h-8 w-36 text-xs rounded-pill"
              title="Filter by Status"
            />
          </div>

          {(searchQuery || roleFilter || statusFilter) && (
            <button
              onClick={() => {
                setSearchQuery('');
                setRoleFilter('');
                setStatusFilter('');
              }}
              className="text-xs text-violet-600 dark:text-violet-400 hover:underline font-semibold ml-1 cursor-pointer"
            >
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {/* Users Table */}
      <div className="glass border border-[var(--line)] rounded-card overflow-hidden shadow-sm">
        {users.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300">
              <thead className="bg-slate-100/60 dark:bg-slate-950/60 text-slate-500 dark:text-slate-400 uppercase text-[10px] font-bold tracking-wider border-b border-[var(--line)]">
                <tr>
                  <th className="py-3.5 px-4">User</th>
                  <th className="py-3.5 px-4">Role</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4">Registered Date</th>
                  <th className="py-3.5 px-4">Last Login</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)] font-sans">
                {users.map((u) => {
                  const isCurrent = currentUser?.id === u.id || currentUser?.email === u.email;
                  return (
                    <tr key={u.id} className="hover:bg-violet-500/5 dark:hover:bg-violet-500/10 transition-colors">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-2xl bg-gradient-to-tr from-violet-500/15 to-pink-500/15 border border-violet-500/25 flex items-center justify-center font-bold text-xs text-violet-600 dark:text-violet-400 shadow-sm">
                            {u.name ? u.name.charAt(0).toUpperCase() : u.email.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                              <span>{u.name || 'Unnamed User'}</span>
                              {isCurrent && (
                                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-pill bg-violet-500/15 text-violet-700 dark:text-violet-300 border border-violet-500/30 font-bold">
                                  YOU
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">{u.email}</div>
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        <span
                          className={`px-2.5 py-1 rounded-pill text-[11px] font-mono uppercase font-bold border ${getRoleBadgeStyle(
                            u.role
                          )}`}
                        >
                          {u.role}
                        </span>
                      </td>

                      <td className="py-3 px-4">
                        {u.status === 'ACTIVE' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-pill text-[11px] font-bold bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30">
                            <CheckCircle2 className="w-3 h-3" />
                            ACTIVE
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-pill text-[11px] font-bold bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-500/30">
                            <XCircle className="w-3 h-3" />
                            INACTIVE
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-4 text-slate-500 dark:text-slate-400 font-mono text-[11px]">
                        {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : 'N/A'}
                      </td>

                      <td className="py-3 px-4 text-slate-500 dark:text-slate-400 font-mono text-[11px]">
                        {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never'}
                      </td>

                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => openEditModal(u)}
                            className="px-3 py-1.5 rounded-pill bg-white/80 dark:bg-slate-900/80 hover:bg-white dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white border border-[var(--line)] text-xs font-semibold transition-all flex items-center gap-1.5 shadow-sm"
                            title="Edit Role or Status"
                          >
                            <Edit2 className="w-3.5 h-3.5 text-violet-500" />
                            <span>Edit</span>
                          </button>

                          <button
                            onClick={() => openResetModal(u)}
                            className="px-3 py-1.5 rounded-pill bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-400 border border-amber-500/30 text-xs font-semibold transition-all flex items-center gap-1.5 shadow-sm"
                            title="Reset User Password"
                          >
                            <KeyRound className="w-3.5 h-3.5 text-amber-500" />
                            <span>Reset Password</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center text-slate-500 dark:text-slate-400 text-xs">
            {loading ? 'Loading team accounts...' : 'No users found matching current filters.'}
          </div>
        )}
      </div>

      {/* Edit User Modal */}
      {editModalUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 dark:bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="relative w-full max-w-md rounded-card glass dark:bg-slate-900/95 bg-white/95 border border-[var(--line)] shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-5 bg-slate-50/60 dark:bg-slate-950/60 border-b border-[var(--line)]">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/20">
                  <Edit2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">Edit User</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-mono truncate max-w-[240px]">
                    {editModalUser.email}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setEditModalUser(null)}
                className="p-1.5 rounded-pill text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveUser} className="p-5 space-y-4">
              {editError && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-300 text-xs flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                  <span>{editError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Display Name
                </label>
                <input
                  type="text"
                  required
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className="w-full px-3.5 py-2 rounded-xl bg-white/80 dark:bg-slate-950/60 border border-[var(--line)] text-xs text-slate-900 dark:text-white focus:outline-none focus:border-violet-500 shadow-inner"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Role
                </label>
                <CustomSelect
                  value={editForm.role}
                  onChange={(val) => {
                    const role = val?.target ? val.target.value : val;
                    setEditForm({ ...editForm, role });
                  }}
                  options={ROLES.map((r) => ({ value: r, label: r }))}
                  className="w-full h-10 text-xs rounded-xl"
                  title="Select Role"
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  ADMIN: Full administrative access • EDITOR: Manage builds and test runs • TESTER: Execute tests • DEVELOPER: Read telemetry • VIEWER: Read only
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Account Status
                </label>
                <CustomSelect
                  value={editForm.status}
                  onChange={(val) => {
                    const status = val?.target ? val.target.value : val;
                    setEditForm({ ...editForm, status });
                  }}
                  options={[
                    { value: 'ACTIVE', label: 'ACTIVE (Authorized to sign in)' },
                    { value: 'INACTIVE', label: 'INACTIVE (Deactivated / Blocked)' }
                  ]}
                  className="w-full h-10 text-xs rounded-xl"
                  title="Select Account Status"
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  Deactivating a user revokes all their active sessions immediately.
                </p>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-[var(--line)]">
                <button
                  type="button"
                  onClick={() => setEditModalUser(null)}
                  className="px-4 py-2 rounded-pill bg-white/80 dark:bg-slate-900/80 hover:bg-white dark:hover:bg-slate-800 border border-[var(--line)] text-xs font-semibold text-slate-700 dark:text-slate-300 transition-all shadow-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editLoading}
                  className="btn-magic px-4 py-2 rounded-pill text-xs font-bold text-white transition-all flex items-center gap-2 disabled:opacity-50 shadow-md cursor-pointer"
                >
                  {editLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
                  <span>Save Changes</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {resetModalUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 dark:bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="relative w-full max-w-md rounded-card glass dark:bg-slate-900/95 bg-white/95 border border-[var(--line)] shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-5 bg-slate-50/60 dark:bg-slate-950/60 border-b border-[var(--line)]">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-amber-500/10 text-amber-500 border border-amber-500/20">
                  <KeyRound className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">Reset User Password</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-mono truncate max-w-[240px]">
                    {resetModalUser.email}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setResetModalUser(null)}
                className="p-1.5 rounded-pill text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {resetError && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-300 text-xs flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                  <span>{resetError}</span>
                </div>
              )}

              {resetResult ? (
                <div className="space-y-4">
                  <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 space-y-2">
                    <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 text-xs font-bold">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Password Reset Successfully</span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-300">
                      Provide this temporary password to the user. Existing active sessions for this account have been invalidated.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      New Temporary Password
                    </label>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm font-mono text-amber-400 font-bold select-all tracking-wider shadow-inner">
                        {resetResult}
                      </div>
                      <button
                        onClick={handleCopyPassword}
                        className="px-3.5 py-2.5 rounded-pill bg-white/80 dark:bg-slate-900/80 hover:bg-white dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white border border-[var(--line)] text-xs font-semibold transition-all flex items-center gap-1.5 shadow-sm"
                      >
                        {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                        <span>{copied ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-[var(--line)] flex justify-end">
                    <button
                      onClick={() => setResetModalUser(null)}
                      className="btn-magic px-4 py-2 rounded-pill text-xs font-bold text-white transition-all shadow-md cursor-pointer"
                    >
                      Done
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleExecuteReset} className="space-y-4">
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    Are you sure you want to reset the password for <strong className="text-slate-900 dark:text-white">{resetModalUser.name}</strong> ({resetModalUser.email})?
                  </p>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      Custom Temporary Password (Optional)
                    </label>
                    <input
                      type="text"
                      placeholder="Leave blank to generate cryptographically secure password"
                      value={resetCustomPassword}
                      onChange={(e) => setResetCustomPassword(e.target.value)}
                      className="w-full px-3.5 py-2 rounded-xl bg-white/80 dark:bg-slate-950/60 border border-[var(--line)] text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-violet-500 shadow-inner"
                    />
                    <p className="text-[10px] text-slate-500 mt-1">
                      If provided, must be at least 8 chars with uppercase, lowercase, digit, and special character.
                    </p>
                  </div>

                  <div className="p-3 rounded-xl bg-white/60 dark:bg-slate-950/60 border border-[var(--line)] text-[11px] text-slate-500 dark:text-slate-400">
                    Resetting will automatically terminate all active sessions for this user.
                  </div>

                  <div className="flex items-center justify-end gap-3 pt-3 border-t border-[var(--line)]">
                    <button
                      type="button"
                      onClick={() => setResetModalUser(null)}
                      className="px-4 py-2 rounded-pill bg-white/80 dark:bg-slate-900/80 hover:bg-white dark:hover:bg-slate-800 border border-[var(--line)] text-xs font-semibold text-slate-700 dark:text-slate-300 transition-all shadow-sm"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={resetLoading}
                      className="px-4 py-2 rounded-pill bg-rose-600 hover:bg-rose-500 text-xs font-bold text-white transition-all flex items-center gap-2 disabled:opacity-50 shadow-md cursor-pointer"
                    >
                      {resetLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
                      <span>Confirm Reset</span>
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
