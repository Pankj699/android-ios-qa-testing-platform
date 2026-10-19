import * as React from "react";
import { getModuleSettings, saveModuleSettings } from "../lib/scoped-storage";
import { useAuth } from "../context/auth-context";

export function useModuleSettings() {
  const { session } = useAuth();
  const [settings, setSettings] = React.useState(null);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    if (!session?.userId) {
      setSettings(null);
      setLoaded(true);
      return;
    }
    const current = getModuleSettings(session.userId);
    setSettings(current);
    setLoaded(true);
  }, [session?.userId]);

  const update = React.useCallback(
    (next) => {
      if (!session?.userId) return;
      saveModuleSettings(session.userId, next);
      setSettings(next);
      // Dispatch custom event so any other component or header can react
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("bugdesk:settings-updated", { detail: next }));
      }
    },
    [session?.userId]
  );

  // Listen for settings-updated events from other components (like SwitchModuleDialog)
  React.useEffect(() => {
    function handleUpdate(e) {
      if (e.detail) {
        setSettings(e.detail);
      }
    }
    if (typeof window !== "undefined") {
      window.addEventListener("bugdesk:settings-updated", handleUpdate);
      return () => window.removeEventListener("bugdesk:settings-updated", handleUpdate);
    }
  }, []);

  return { settings, update, loaded };
}

export default useModuleSettings;
