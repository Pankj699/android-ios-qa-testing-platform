import * as React from "react";
import { BugDeskAuthProvider } from "./context/auth-context";
import { useModuleSettings } from "./hooks/use-module-settings";
import BugDeskDashboard from "./pages/BugDeskDashboard";
import BugDeskNewBug from "./pages/BugDeskNewBug";
import BugDeskHistory from "./pages/BugDeskHistory";
import BugDeskSettings from "./pages/BugDeskSettings";
import BugDeskOnboarding from "./pages/BugDeskOnboarding";
import SwitchModuleDialog from "./components/SwitchModuleDialog";
import { Loader2 } from "lucide-react";

function BugDeskContent({
  activeSubTab = "dashboard",
  onSelectSubTab,
  switchModuleOpen,
  setSwitchModuleOpen,
}) {
  const { settings, update, loaded } = useModuleSettings();
  const [forceOnboarding, setForceOnboarding] = React.useState(false);

  // If settings not loaded yet
  if (!loaded) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-amber-500" />
      </div>
    );
  }

  // If first time and no settings, show onboarding unless dismissed
  if (!settings && !forceOnboarding) {
    return (
      <BugDeskOnboarding
        onComplete={() => {
          setForceOnboarding(true);
          if (onSelectSubTab) onSelectSubTab("dashboard");
        }}
      />
    );
  }

  return (
    <div className="flex-1 min-w-0">
      {activeSubTab === "dashboard" && <BugDeskDashboard onNavigate={onSelectSubTab} />}
      <div className={activeSubTab === "new-bug" ? "block" : "hidden"}>
        <BugDeskNewBug onNavigate={onSelectSubTab} />
      </div>
      {activeSubTab === "history" && <BugDeskHistory onNavigate={onSelectSubTab} />}
      {activeSubTab === "settings" && <BugDeskSettings onNavigate={onSelectSubTab} />}

      <SwitchModuleDialog
        open={Boolean(switchModuleOpen)}
        onOpenChange={setSwitchModuleOpen}
        initial={settings}
        onSave={update}
      />
    </div>
  );
}

export function BugDeskApp({
  currentUser,
  onLogout,
  activeSubTab = "dashboard",
  onSelectSubTab,
  switchModuleOpen,
  setSwitchModuleOpen,
}) {
  return (
    <BugDeskAuthProvider currentUser={currentUser} onLogout={onLogout}>
      <BugDeskContent
        activeSubTab={activeSubTab}
        onSelectSubTab={onSelectSubTab}
        switchModuleOpen={switchModuleOpen}
        setSwitchModuleOpen={setSwitchModuleOpen}
      />
    </BugDeskAuthProvider>
  );
}

export default BugDeskApp;
