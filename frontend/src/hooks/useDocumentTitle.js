import { useEffect } from 'react';
import { getDocumentTitle, QA_PLATFORM_BASE_TITLE } from '../utils/navigationTitles';

/**
 * Hook to dynamically update document.title based on the active tab and current route.
 * Automatically synchronizes on tab change, direct navigation, and browser back/forward (popstate).
 *
 * @param {string} currentTab - The currently active tab identifier in the application
 */
export function useDocumentTitle(currentTab) {
  useEffect(() => {
    const updateTitle = () => {
      const pathname = typeof window !== 'undefined' ? window.location.pathname : '/';
      const title = getDocumentTitle(currentTab, pathname);
      if (document.title !== title) {
        document.title = title;
      }
    };

    updateTitle();

    window.addEventListener('popstate', updateTitle);
    return () => {
      window.removeEventListener('popstate', updateTitle);
    };
  }, [currentTab]);
}

export default useDocumentTitle;
