import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { t } from '../i18n/translations';
import type { Lang } from '../i18n/translations';
import './InstallPrompt.css';

interface InstallPromptProps {
  lang: Lang;
}

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true;

export const InstallPrompt: React.FC<InstallPromptProps> = ({ lang }) => {
  const tr = t(lang);

  // deferredPrompt: set when Chrome/Edge fires beforeinstallprompt (app not yet installed)
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  // dismissed: user clicked "Agora não" — hide for this session only (no localStorage)
  const [dismissed, setDismissed] = useState(false);

  // iosReady: show iOS banner after short delay (only if iOS and not standalone)
  const [iosReady, setIosReady] = useState(false);

  const [showInstructions, setShowInstructions] = useState(false);

  useEffect(() => {
    // Already running as installed PWA → never show
    if (isStandalone) return;

    if (isIOS) {
      // On iOS there's no beforeinstallprompt; show our manual instructions after a delay
      const timer = setTimeout(() => setIosReady(true), 2500);
      return () => clearTimeout(timer);
    }

    // Chrome / Edge / Android: only show when the browser tells us it's installable
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    const handleAppInstalled = () => {
      setDeferredPrompt(null);
    };
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setDeferredPrompt(null);
      }
    } else {
      // iOS: show manual instructions modal
      setShowInstructions(true);
    }
  };

  // Determine whether to show the banner at all
  const shouldShow = !dismissed && !isStandalone && (deferredPrompt !== null || (isIOS && iosReady));

  if (!shouldShow) return null;

  return (
    <>
      <div className="install-prompt-banner fade-in">
        <div className="install-prompt-content">
          <div className="install-icon">
            <img src="/icons/app-icon-192.png?v=2" alt="Forex Rendimento" width={38} height={38} className="install-icon-img" />
          </div>
          <div className="install-text">
            <strong>{tr.install_title}</strong>
            <p>{tr.install_subtitle}</p>
          </div>
        </div>
        <div className="install-actions">
          <button className="btn-install" onClick={handleInstallClick}>{tr.install_btn}</button>
          <button className="btn-dismiss" onClick={() => setDismissed(true)}>
            <X size={16} />
          </button>
        </div>
      </div>

      {showInstructions && (
        <div className="install-modal-overlay fade-in" onClick={() => setShowInstructions(false)}>
          <div className="install-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{tr.install_modal_title}</h3>
              <button className="btn-close" onClick={() => setShowInstructions(false)}><X size={20} /></button>
            </div>
            <div className="modal-body">
              {isIOS ? (
                <>
                  <p>{tr.install_ios_intro}</p>
                  <ol>
                    <li>{tr.install_ios_step1}<strong>{tr.install_ios_step1_strong}</strong>{tr.install_ios_step1_suffix}</li>
                    <li>{tr.install_ios_step2}<strong>{tr.install_ios_step2_strong}</strong>{tr.install_ios_step2_suffix}</li>
                  </ol>
                </>
              ) : (
                <>
                  <p>{tr.install_android_intro}</p>
                  <ol>
                    <li>{tr.install_android_step1}<strong>{tr.install_android_step1_strong}</strong>{tr.install_android_step1_suffix}</li>
                    <li>{tr.install_android_step2}<strong>{tr.install_android_step2_strong}</strong>{tr.install_android_step2_or}<strong>{tr.install_android_step2_strong2}</strong>{tr.install_android_step2_suffix}</li>
                  </ol>
                </>
              )}
              <button className="btn-primary" style={{ width: '100%', marginTop: '15px' }} onClick={() => setShowInstructions(false)}>{tr.install_understood}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
