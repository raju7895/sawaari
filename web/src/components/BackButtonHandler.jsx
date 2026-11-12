import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

/**
 * Android hardware back button.
 *
 * Inside the native shell the back button must walk the app's own history
 * (a SPA keeps its routes in the history stack) and only leave the app
 * when there is nothing left to go back to. On the web the browser
 * handles it, so nothing is registered.
 */
export default function BackButtonHandler() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    let remove = null;
    let cancelled = false;

    (async () => {
      try {
        const cap = window.Capacitor;
        if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) return;
        const { App } = await import('@capacitor/app');
        const handle = await App.addListener('backButton', () => {
          // a modal/dialog on screen closes first
          const dialog = document.querySelector('[role="dialog"]');
          if (dialog) {
            const close = dialog.querySelector('button[aria-label="Close"]');
            if (close) close.click();
            return;
          }
          // walk back through the app's own routes
          if (window.history.length > 1 && window.history.state) {
            window.history.back();
            return;
          }
          if (location.pathname !== '/') {
            navigate('/');
            return;
          }
          App.minimizeApp();
        });
        if (!cancelled) remove = handle;
        else handle.remove();
      } catch {
        /* the plugin is not available (web build) — nothing to do */
      }
    })();

    return () => {
      cancelled = true;
      if (remove) remove.remove();
    };
  }, [navigate, location.pathname]);

  return null;
}
