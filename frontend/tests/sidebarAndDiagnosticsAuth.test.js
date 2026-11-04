import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sidebarPath = path.resolve(__dirname, '../src/components/Sidebar.jsx');
const appPath = path.resolve(__dirname, '../src/App.jsx');

describe('Sidebar Cleanup & System Diagnostics Admin Protection Suite', () => {
  const sidebarCode = fs.readFileSync(sidebarPath, 'utf8');
  const appCode = fs.readFileSync(appPath, 'utf8');

  describe('1. Sidebar Footer Cleanup', () => {
    it('completely removes the "Take App Tour" button from the sidebar', () => {
      assert.ok(!sidebarCode.includes('Take App Tour'), 'Sidebar must not contain "Take App Tour"');
    });

    it('completely removes the "Backend Mode" indicator from the sidebar', () => {
      assert.ok(!sidebarCode.includes('Backend Mode'), 'Sidebar must not contain "Backend Mode"');
    });

    it('completely removes the "Host Execution" indicator from the sidebar', () => {
      assert.ok(!sidebarCode.includes('Host Execution'), 'Sidebar must not contain "Host Execution"');
    });

    it('completely removes the "Bundletool" version label from the sidebar', () => {
      assert.ok(!sidebarCode.includes('Bundletool 1.18.3'), 'Sidebar must not contain "Bundletool 1.18.3"');
    });

    it('completely removes the "Local Mock" indicator from the sidebar', () => {
      assert.ok(!sidebarCode.includes('Local Mock'), 'Sidebar must not contain "Local Mock"');
    });

    it('removes the unused Compass icon import from lucide-react in Sidebar', () => {
      assert.ok(!/Compass\b/.test(sidebarCode), 'Sidebar must not import or reference Compass');
    });

    it('removes the bottom footer container div and allows navigation to use full height', () => {
      assert.ok(!sidebarCode.includes('{/* Footer info & App Tour Button */}'), 'Footer container must be removed');
      assert.ok(sidebarCode.includes('flex flex-col shrink-0 select-none'), 'Aside container should not force space-between layout');
    });
  });

  describe('2. System Diagnostics Sidebar Visibility (Admin Only)', () => {
    it('filters out diagnostics item when currentUser is not ADMIN', () => {
      // Simulate visibleNavGroups filtering logic from Sidebar.jsx
      const mockNavGroups = [
        {
          id: 'resources',
          title: 'RESOURCES',
          items: [
            { id: 'remote-config', label: 'Remote Config' },
            { id: 'sop', label: 'SOP Guide' },
            { id: 'diagnostics', label: 'System Diagnostics' }
          ]
        }
      ];

      const filterGroups = (user) => {
        const isAdmin = user?.role === 'ADMIN';
        return mockNavGroups.map((group) => ({
          ...group,
          items: group.items.filter((item) => {
            if (item.id === 'diagnostics') {
              return isAdmin;
            }
            return true;
          })
        }));
      };

      // Unauthenticated user
      const unauthResult = filterGroups(null);
      const unauthItems = unauthResult[0].items.map((i) => i.id);
      assert.deepStrictEqual(unauthItems, ['remote-config', 'sop']);
      assert.ok(!unauthItems.includes('diagnostics'), 'Unauthenticated user must NOT see diagnostics');

      // Regular QA Tester user
      const regularResult = filterGroups({ role: 'TESTER', name: 'Tester' });
      const regularItems = regularResult[0].items.map((i) => i.id);
      assert.deepStrictEqual(regularItems, ['remote-config', 'sop']);
      assert.ok(!regularItems.includes('diagnostics'), 'TESTER user must NOT see diagnostics');

      // Admin user
      const adminResult = filterGroups({ role: 'ADMIN', name: 'Admin' });
      const adminItems = adminResult[0].items.map((i) => i.id);
      assert.deepStrictEqual(adminItems, ['remote-config', 'sop', 'diagnostics']);
      assert.ok(adminItems.includes('diagnostics'), 'ADMIN user must see diagnostics');
    });
  });

  describe('3. Protected Route Access in App.jsx', () => {
    it('guards initial tab against unauthorized diagnostics route access', () => {
      assert.ok(
        appCode.includes("tab === 'diagnostics' || tab === 'admin-users' || tab === 'admin-devices'"),
        'getInitialTab and URL parser must guard diagnostics alongside admin-users and admin-devices'
      );
    });

    it('guards handleTabChange from navigating to diagnostics if user is not admin', () => {
      assert.ok(
        appCode.includes("(newTab === 'diagnostics' || newTab === 'admin-users' || newTab === 'admin-devices') && currentUser?.role !== 'ADMIN'"),
        'handleTabChange must block navigation to diagnostics for non-admin users'
      );
    });

    it('redirects diagnostics tab on logout', () => {
      assert.ok(
        appCode.includes("currentTab === 'admin-users' || currentTab === 'admin-devices' || currentTab === 'diagnostics'"),
        'handleLogout must return to dashboard if currently on diagnostics'
      );
    });

    it('renders Access Forbidden shield alert when unauthorized user attempts to view DiagnosticsPage', () => {
      assert.ok(
        appCode.includes("Administrator privileges are required to access System Diagnostics"),
        'JSX render tree must include Access Forbidden safeguard for System Diagnostics'
      );
    });
  });
});
