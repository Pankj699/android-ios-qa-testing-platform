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

  const [notification, setNotification] = useState(null);

  const showNotification = (msg, type = 'success') => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 4000);
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
    <div className="space-y-6 fade-in">
      {/* Toast Notification */}
      {notification && (
        <div
          className={`fixed bottom-5 right-5 z-50 px-4 py-3 rounded-xl border shadow-xl flex items-center gap-2 text-xs font-semibold animate-fadeIn ${
            notification.type === 'error'
              ? 'bg-rose-950/90 border-rose-800 text-rose-200'
              : 'bg-emerald-950/90 border-emerald-800 text-emerald-200'
          }`}
        >
          {notification.type === 'error' ? <AlertTriangle className="w-4 h-4 text-rose-400" /> : <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
          <span>{notification.msg}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-[#1E2638]">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2.5">
            <ShieldCheck className="w-5 h-5 text-[#F59E0B]" />
            User Management & Access Control
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Manage platform users, assign role-based permissions (RBAC), control account status, and perform admin password resets.
          </p>
        </div>

        <button
          onClick={loadUsers}
          disabled={loading}
          className="p-2 rounded-lg bg-[#1E2638] hover:bg-[#263248] text-slate-300 hover:text-white transition-colors border border-[#334155]"
          title="Refresh Users"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-[#131924] border border-[#1E2638]">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
            <span>Total Accounts</span>
            <Users className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-2xl font-bold text-white font-mono">{summary.total}</div>
        </div>

        <div className="p-4 rounded-xl bg-[#131924] border border-[#1E2638]">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
            <span>Active Users</span>
            <UserCheck className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-emerald-400 font-mono">{summary.active}</div>
        </div>

        <div className="p-4 rounded-xl bg-[#131924] border border-[#1E2638]">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
            <span>Inactive Users</span>
            <UserX className="w-4 h-4 text-rose-400" />
          </div>
          <div className="text-2xl font-bold text-rose-400 font-mono">{summary.inactive}</div>
        </div>

        <div className="p-4 rounded-xl bg-[#131924] border border-[#1E2638]">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
            <span>Administrators</span>
            <Shield className="w-4 h-4 text-[#F59E0B]" />
          </div>
          <div className="text-2xl font-bold text-[#F59E0B] font-mono">{summary.administrators}</div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="p-4 rounded-xl bg-[#131924] border border-[#1E2638] flex flex-wrap items-center justify-between gap-4">
        <form onSubmit={handleSearchSubmit} className="flex items-center gap-2 flex-1 max-w-md">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search by name or email..."
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

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Role:</span>
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-[#0A0D14] border border-[#1E2638] text-xs text-slate-200 focus:outline-none focus:border-[#F59E0B]"
            >
              <option value="">All Roles</option>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-[#0A0D14] border border-[#1E2638] text-xs text-slate-200 focus:outline-none focus:border-[#F59E0B]"
            >
              <option value="">All Statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          {(searchQuery || roleFilter || statusFilter) && (
            <button
              onClick={() => {
                setSearchQuery('');
                setRoleFilter('');
                setStatusFilter('');
              }}
              className="text-xs text-slate-400 hover:text-white underline underline-offset-2 ml-1"
            >
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-[#131924] border border-[#1E2638] rounded-xl overflow-hidden shadow-sm">
        {users.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-[#0D111A] text-slate-400 uppercase text-[10px] font-semibold tracking-wider border-b border-[#1E2638]">
                <tr>
                  <th className="py-3.5 px-4">User</th>
                  <th className="py-3.5 px-4">Role</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4">Registered Date</th>
                  <th className="py-3.5 px-4">Last Login</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1E2638]/60 font-sans">
                {users.map((u) => {
                  const isCurrent = currentUser?.id === u.id || currentUser?.email === u.email;
                  return (
                    <tr key={u.id} className="hover:bg-[#1E2638]/40 transition-colors">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-[#1E2638] border border-[#334155] flex items-center justify-center font-bold text-xs text-[#F59E0B]">
                            {u.name ? u.name.charAt(0).toUpperCase() : u.email.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-semibold text-white flex items-center gap-1.5">
                              <span>{u.name || 'Unnamed User'}</span>
                              {isCurrent && (
                                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-amber-500/20 text-[#F59E0B] border border-amber-500/30">
                                  YOU
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-400 font-mono">{u.email}</div>
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        <span
                          className={`px-2.5 py-1 rounded text-[11px] font-mono uppercase font-bold border ${getRoleBadgeStyle(
                            u.role
                          )}`}
                        >
                          {u.role}
                        </span>
                      </td>

                      <td className="py-3 px-4">
                        {u.status === 'ACTIVE' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                            <CheckCircle2 className="w-3 h-3" />
                            ACTIVE
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/30">
                            <XCircle className="w-3 h-3" />
                            INACTIVE
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-4 text-slate-400 font-mono text-[11px]">
                        {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : 'N/A'}
                      </td>

                      <td className="py-3 px-4 text-slate-400 font-mono text-[11px]">
                        {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never'}
                      </td>

                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => openEditModal(u)}
                            className="px-2.5 py-1.5 rounded-lg bg-[#1E2638] hover:bg-[#263248] text-slate-200 hover:text-white border border-[#334155] text-xs font-medium transition-colors flex items-center gap-1.5"
                            title="Edit Role or Status"
                          >
                            <Edit2 className="w-3.5 h-3.5 text-slate-400" />
                            <span>Edit</span>
                          </button>

                          <button
                            onClick={() => openResetModal(u)}
                            className="px-2.5 py-1.5 rounded-lg bg-[#261D10] hover:bg-[#3D2C15] text-[#F59E0B] hover:text-[#FBBF24] border border-[#78350F] text-xs font-medium transition-colors flex items-center gap-1.5"
                            title="Reset User Password"
                          >
                            <KeyRound className="w-3.5 h-3.5 text-[#F59E0B]" />
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
          <div className="p-8 text-center text-slate-400 text-xs">
            {loading ? 'Loading team accounts...' : 'No users found matching current filters.'}
          </div>
        )}
      </div>

      {/* Edit User Modal */}
      {editModalUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fadeIn">
          <div className="relative w-full max-w-md rounded-2xl bg-[#0F1420] border border-[#1E2638] shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-5 bg-[#141B2D] border-b border-[#1E2638]">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-[#F59E0B]/10 text-[#F59E0B] border border-[#F59E0B]/20">
                  <Edit2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Edit User</h3>
                  <p className="text-xs text-slate-400 font-mono truncate max-w-[240px]">
                    {editModalUser.email}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setEditModalUser(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#1E2638] transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveUser} className="p-5 space-y-4">
              {editError && (
                <div className="p-3 rounded-lg bg-rose-950/60 border border-rose-800 text-rose-200 text-xs flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <span>{editError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Display Name
                </label>
                <input
                  type="text"
                  required
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-[#0A0D14] border border-[#1E2638] text-xs text-white focus:outline-none focus:border-[#F59E0B]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Role
                </label>
                <select
                  value={editForm.role}
                  onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-[#0A0D14] border border-[#1E2638] text-xs text-white focus:outline-none focus:border-[#F59E0B]"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-slate-500 mt-1">
                  ADMIN: Full administrative access • EDITOR: Manage builds and test runs • TESTER: Execute tests • DEVELOPER: Read telemetry • VIEWER: Read only
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Account Status
                </label>
                <select
                  value={editForm.status}
                  onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-[#0A0D14] border border-[#1E2638] text-xs text-white focus:outline-none focus:border-[#F59E0B]"
                >
                  <option value="ACTIVE">ACTIVE (Authorized to sign in)</option>
                  <option value="INACTIVE">INACTIVE (Deactivated / Blocked)</option>
                </select>
                <p className="text-[10px] text-slate-500 mt-1">
                  Deactivating a user revokes all their active sessions immediately.
                </p>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#1E2638]">
                <button
                  type="button"
                  onClick={() => setEditModalUser(null)}
                  className="px-4 py-2 rounded-lg bg-[#131924] hover:bg-[#1E2638] text-xs font-semibold text-slate-300 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editLoading}
                  className="px-4 py-2 rounded-lg bg-[#F59E0B] hover:bg-[#D97706] text-xs font-bold text-black transition-all flex items-center gap-2 disabled:opacity-50"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fadeIn">
          <div className="relative w-full max-w-md rounded-2xl bg-[#0F1420] border border-[#1E2638] shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-5 bg-[#141B2D] border-b border-[#1E2638]">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-[#F59E0B]/10 text-[#F59E0B] border border-[#F59E0B]/20">
                  <KeyRound className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Reset User Password</h3>
                  <p className="text-xs text-slate-400 font-mono truncate max-w-[240px]">
                    {resetModalUser.email}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setResetModalUser(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#1E2638] transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {resetError && (
                <div className="p-3 rounded-lg bg-rose-950/60 border border-rose-800 text-rose-200 text-xs flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <span>{resetError}</span>
                </div>
              )}

              {resetResult ? (
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-800/60 space-y-2">
                    <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Password Reset Successfully</span>
                    </div>
                    <p className="text-xs text-slate-300">
                      Provide this temporary password to the user. Existing active sessions for this account have been invalidated.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      New Temporary Password
                    </label>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 px-3 py-2.5 rounded-lg bg-[#0A0D14] border border-[#1E2638] text-sm font-mono text-[#F59E0B] font-bold select-all tracking-wider">
                        {resetResult}
                      </div>
                      <button
                        onClick={handleCopyPassword}
                        className="px-3.5 py-2.5 rounded-lg bg-[#1E2638] hover:bg-[#263248] text-slate-200 hover:text-white border border-[#334155] text-xs font-semibold transition-colors flex items-center gap-1.5"
                      >
                        {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                        <span>{copied ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-[#1E2638] flex justify-end">
                    <button
                      onClick={() => setResetModalUser(null)}
                      className="px-4 py-2 rounded-lg bg-[#F59E0B] hover:bg-[#D97706] text-xs font-bold text-black transition-all"
                    >
                      Done
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleExecuteReset} className="space-y-4">
                  <p className="text-xs text-slate-300">
                    Are you sure you want to reset the password for <strong className="text-white">{resetModalUser.name}</strong> ({resetModalUser.email})?
                  </p>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      Custom Temporary Password (Optional)
                    </label>
                    <input
                      type="text"
                      placeholder="Leave blank to generate cryptographically secure password"
                      value={resetCustomPassword}
                      onChange={(e) => setResetCustomPassword(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-[#0A0D14] border border-[#1E2638] text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#F59E0B]"
                    />
                    <p className="text-[10px] text-slate-500 mt-1">
                      If provided, must be at least 8 chars with uppercase, lowercase, digit, and special character.
                    </p>
                  </div>

                  <div className="p-3 rounded-lg bg-[#141B2D] border border-[#1E2638] text-[11px] text-slate-400">
                    Resetting will automatically terminate all active sessions for this user.
                  </div>

                  <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#1E2638]">
                    <button
                      type="button"
                      onClick={() => setResetModalUser(null)}
                      className="px-4 py-2 rounded-lg bg-[#131924] hover:bg-[#1E2638] text-xs font-semibold text-slate-300 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={resetLoading}
                      className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-xs font-bold text-white transition-all flex items-center gap-2 disabled:opacity-50"
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
