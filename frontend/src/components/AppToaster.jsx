import React from 'react';
import { Toaster } from 'sonner';
import { CheckCircle2, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

/**
 * Global AppToaster mounted once at root.
 * Listens to active ThemeContext and enforces top-right positioning,
 * centralized z-index, accessibility, and uniform green/red aesthetics.
 */
export default function AppToaster() {
  const { theme } = useTheme();

  return (
    <Toaster
      position="top-right"
      theme={theme === 'dark' ? 'dark' : 'light'}
      richColors
      closeButton
      offset={{ top: 72, right: 24 }}
      pauseWhenPageIsHidden
      visibleToasts={5}
      gap={10}
      icons={{
        success: <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />,
        error: <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />,
        info: <Info className="w-4 h-4 text-sky-500 shrink-0" />,
        warning: <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />,
      }}
      toastOptions={{
        className: 'qa-global-toast',
      }}
    />
  );
}
