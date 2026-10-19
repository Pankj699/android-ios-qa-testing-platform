import React, { createContext, useContext, useMemo } from "react";

const AuthContext = createContext(null);

export function BugDeskAuthProvider({ children, currentUser, onLogout }) {
  const session = useMemo(() => {
    if (!currentUser) return null;
    return {
      userId: currentUser.id || currentUser.email,
      name: currentUser.name || (currentUser.email ? currentUser.email.split('@')[0] : 'QA Engineer'),
      email: currentUser.email || '',
      role: currentUser.role || 'TESTER',
    };
  }, [currentUser]);

  const value = useMemo(() => ({
    session,
    loading: false,
    logout: () => {
      if (onLogout) onLogout();
    },
    renameUser: (newName) => {
      // Scoped rename or profile update
      if (session?.userId && typeof window !== "undefined") {
        try {
          const stored = window.localStorage.getItem(`qabr:${session.userId}:profile`);
          const prof = stored ? JSON.parse(stored) : {};
          prof.name = newName;
          window.localStorage.setItem(`qabr:${session.userId}:profile`, JSON.stringify(prof));
        } catch {}
      }
    }
  }), [session, onLogout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within BugDeskAuthProvider");
  }
  return ctx;
}

export default BugDeskAuthProvider;
