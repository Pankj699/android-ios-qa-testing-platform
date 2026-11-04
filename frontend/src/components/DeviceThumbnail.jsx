import React, { useState, useEffect } from 'react';
import { socketService } from '../services/socket';

/**
 * High-precision SVG Fallback Illustrations (Theme-Aware & High-Contrast)
 */
function AndroidPhoneIllustration({ className = '', isVirtual = false }) {
  return (
    <svg viewBox="0 0 36 72" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      {/* Outer frame */}
      <rect
        x="2"
        y="2"
        width="32"
        height="68"
        rx="6"
        className="fill-slate-200 dark:fill-[#1E2638] stroke-slate-400 dark:stroke-[#3E4C66]"
        strokeWidth="1.5"
      />
      {/* Screen */}
      <rect
        x="4.5"
        y="6.5"
        width="27"
        height="59"
        rx="3.5"
        className={isVirtual
          ? "fill-cyan-950/40 dark:fill-[#0B1526] stroke-cyan-500/40 dark:stroke-cyan-500/30"
          : "fill-white dark:fill-[#0D121F] stroke-slate-200 dark:stroke-[#253046]"}
        strokeWidth="1"
      />
      {/* Front camera punch-hole */}
      <circle cx="18" cy="10" r="1.3" className="fill-slate-400 dark:fill-slate-500" />
      {/* Bottom home indicator line */}
      <rect
        x="13"
        y="61.5"
        width="10"
        height="1.2"
        rx="0.6"
        className={isVirtual ? "fill-cyan-500/70 dark:fill-cyan-400/60" : "fill-slate-300 dark:fill-slate-600"}
      />
      {/* Subtle screen reflection */}
      <path d="M4.5 6.5 L24 6.5 L4.5 36 Z" fill="white" className="opacity-40 dark:opacity-10 pointer-events-none" />
    </svg>
  );
}

function AndroidTabletIllustration({ className = '', isVirtual = false }) {
  return (
    <svg viewBox="0 0 54 72" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      {/* Tablet outer frame */}
      <rect
        x="2"
        y="2"
        width="50"
        height="68"
        rx="6"
        className="fill-slate-200 dark:fill-[#1E2638] stroke-slate-400 dark:stroke-[#3E4C66]"
        strokeWidth="1.5"
      />
      {/* Tablet screen */}
      <rect
        x="5.5"
        y="6.5"
        width="43"
        height="59"
        rx="4"
        className={isVirtual
          ? "fill-cyan-950/40 dark:fill-[#0B1526] stroke-cyan-500/40 dark:stroke-cyan-500/30"
          : "fill-white dark:fill-[#0D121F] stroke-slate-200 dark:stroke-[#253046]"}
        strokeWidth="1"
      />
      {/* Tablet front camera */}
      <circle cx="27" cy="4.5" r="1.1" className="fill-slate-400 dark:fill-slate-500" />
      {/* Bottom indicator */}
      <rect
        x="21"
        y="61.5"
        width="12"
        height="1.2"
        rx="0.6"
        className={isVirtual ? "fill-cyan-500/70 dark:fill-cyan-400/60" : "fill-slate-300 dark:fill-slate-600"}
      />
      <path d="M5.5 6.5 L34 6.5 L5.5 44 Z" fill="white" className="opacity-40 dark:opacity-10 pointer-events-none" />
    </svg>
  );
}

function IPhoneIllustration({ className = '' }) {
  return (
    <svg viewBox="0 0 36 72" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <rect x="2" y="2" width="32" height="68" rx="7" className="fill-slate-200 dark:fill-[#1E2638] stroke-slate-400 dark:stroke-[#475569]" strokeWidth="1.5" />
      <rect x="4.5" y="5.5" width="27" height="61" rx="4" className="fill-white dark:fill-[#0E1524] stroke-slate-200 dark:stroke-[#253046]" strokeWidth="1" />
      <rect x="13" y="7.5" width="10" height="2.5" rx="1.25" className="fill-slate-400 dark:fill-[#05070D]" />
      <rect x="12" y="62.5" width="12" height="1.2" rx="0.6" className="fill-slate-300 dark:fill-[#64748B]" />
      <path d="M4.5 5.5 L23 5.5 L4.5 34 Z" fill="white" className="opacity-40 dark:opacity-10 pointer-events-none" />
    </svg>
  );
}

function IPadIllustration({ className = '' }) {
  return (
    <svg viewBox="0 0 54 72" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <rect x="2" y="2" width="50" height="68" rx="6" className="fill-slate-200 dark:fill-[#1E2638] stroke-slate-400 dark:stroke-[#475569]" strokeWidth="1.5" />
      <rect x="5.5" y="5.5" width="43" height="61" rx="3.5" className="fill-white dark:fill-[#0E1524] stroke-slate-200 dark:stroke-[#253046]" strokeWidth="1" />
      <circle cx="27" cy="4" r="1" className="fill-slate-400 dark:fill-[#64748B]" />
      <rect x="20" y="62.5" width="14" height="1.2" rx="0.6" className="fill-slate-300 dark:fill-[#64748B]" />
      <path d="M5.5 5.5 L34 5.5 L5.5 44 Z" fill="white" className="opacity-40 dark:opacity-10 pointer-events-none" />
    </svg>
  );
}

const SIZE_MAP_PHONE = {
  xs: 'w-[20px] h-[30px] min-w-[20px] min-h-[30px] rounded-xs',
  sm: 'w-[28px] h-[42px] min-w-[28px] min-h-[42px] rounded-sm',
  md: 'w-[38px] h-[56px] min-w-[38px] min-h-[56px] rounded-md',
  header: 'w-[46px] h-[74px] min-w-[46px] min-h-[74px] rounded-lg',
  lg: 'w-[56px] h-[94px] min-w-[56px] min-h-[94px] rounded-lg',
  xl: 'w-[62px] h-[104px] min-w-[62px] min-h-[104px] rounded-xl'
};

const SIZE_MAP_TABLET = {
  xs: 'w-[24px] h-[30px] min-w-[24px] min-h-[30px] rounded-xs',
  sm: 'w-[34px] h-[42px] min-w-[34px] min-h-[42px] rounded-sm',
  md: 'w-[46px] h-[56px] min-w-[46px] min-h-[56px] rounded-md',
  header: 'w-[56px] h-[74px] min-w-[56px] min-h-[74px] rounded-lg',
  lg: 'w-[68px] h-[94px] min-w-[68px] min-h-[94px] rounded-lg',
  xl: 'w-[76px] h-[104px] min-w-[76px] min-h-[104px] rounded-xl'
};

export default function DeviceThumbnail({
  device,
  size = 'sm',
  className = '',
  alt
}) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [version, setVersion] = useState(0);
  const [isWideImage, setIsWideImage] = useState(false);

  const isIos = device?.platform === 'ios' ||
    (device?.model && /i(phone|pad|pod)/i.test(device.model)) ||
    (device?.name && /i(phone|pad|pod)/i.test(device.name));

  const rawMfg = isIos ? 'apple' : (device?.manufacturer || '');
  const rawModel = device?.model || (isIos ? (device?.name || 'iphone') : (device?.name || ''));

  const sMfg = String(rawMfg || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const sModel = String(rawModel || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');

  // 1. Authoritative form-factor determination from metadata first
  let isKnownTablet = false;
  let isKnownPhone = false;

  const rawFormFactor = String(device?.formFactor || '').toLowerCase();
  if (rawFormFactor === 'tablet') {
    isKnownTablet = true;
  } else if (rawFormFactor === 'phone') {
    isKnownPhone = true;
  } else {
    // Known tablet model patterns
    if (
      sModel.startsWith('sm-x') || sModel.startsWith('sm_x') ||
      sModel.startsWith('sm-t') || sModel.startsWith('sm_t') ||
      /ipad/i.test(sModel) || /tablet/i.test(sModel) ||
      /\btab\b/i.test(device?.displayName || '') ||
      /\btablet\b/i.test(device?.displayName || '')
    ) {
      isKnownTablet = true;
    } else if (
      sModel.startsWith('sm-e') || sModel.startsWith('sm-m') ||
      sModel.startsWith('sm-a') || sModel.startsWith('sm-s') ||
      sModel.startsWith('sm-g') || sModel.startsWith('sm-f') ||
      /iphone/i.test(sModel) || /phone/i.test(sModel)
    ) {
      isKnownPhone = true;
    }
  }

  // Use image aspect ratio only as fallback when form factor is unknown
  const useWideFrame = isKnownTablet || (!isKnownPhone && isWideImage);

  // Subscribe to real-time image updates via WebSocket
  useEffect(() => {
    if (!device || !sMfg || !sModel) return;

    const unsub = socketService.on('DEVICE_IMAGE_UPDATED', (payload) => {
      if (!payload) return;
      const matchMfg = String(payload.manufacturer || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
      const matchModel = String(payload.model || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');

      if (matchMfg === sMfg && matchModel === sModel) {
        if (payload.removed || payload.status === 'removed') {
          setImgError(true);
          setImgLoaded(false);
          setIsWideImage(false);
          setVersion(payload.timestamp || Date.now());
        } else {
          setVersion(payload.timestamp || Date.now());
          setImgError(false);
          setImgLoaded(false);
        }
      }
    });

    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, [device, sMfg, sModel]);

  const directThumbnailUrl = device?.thumbnailUrl || null;

  // Reset state if model or thumbnail URL changes
  useEffect(() => {
    setImgLoaded(false);
    setImgError(false);
    setIsWideImage(false);
  }, [sMfg, sModel, directThumbnailUrl]);

  if (!device) return null;

  const isVirtual = device?.form === 'VIRTUAL' || Boolean(device?.isVirtual);
  const isCatalogDevice = Boolean(device?.isCatalogDevice || isVirtual);

  const hasIdentifier = Boolean(sMfg && sModel && !isCatalogDevice);
  const imageUrl = directThumbnailUrl || (hasIdentifier
    ? `/api/devices/image/${sMfg}/${sModel}${version ? `?v=${version}` : ''}`
    : null);

  const sizeMap = useWideFrame ? SIZE_MAP_TABLET : SIZE_MAP_PHONE;
  const sizeClass = sizeMap[size] || sizeMap.sm;
  const altText = alt || device.displayName || device.name || 'Connected device thumbnail';

  const handleImageLoad = (e) => {
    const img = e.target;
    if (img && img.naturalWidth && img.naturalHeight) {
      const ratio = img.naturalWidth / img.naturalHeight;
      // Secondary fallback only: wide aspect ratio (>= 0.62) indicates tablet or dual-view render
      if (ratio >= 0.62) {
        setIsWideImage(true);
      }
    }
    setImgLoaded(true);
  };

  const defaultBoxStyle = className.includes('border-0') || className.includes('bg-transparent')
    ? ''
    : 'border border-slate-200/80 dark:border-[#253046] bg-slate-100/60 dark:bg-[#101522] shadow-xs';

  return (
    <div
      className={`relative inline-flex items-center justify-center shrink-0 overflow-hidden ${defaultBoxStyle} ${sizeClass} ${className}`}
      title={device.displayName || device.name || 'Device Thumbnail'}
    >
      {/* 1. Verified Real Model Image (if available) */}
      {imageUrl && !imgError && (
        <img
          src={imageUrl}
          alt={altText}
          loading="lazy"
          onLoad={handleImageLoad}
          onError={() => setImgError(true)}
          className={`w-full h-full object-contain p-0.5 transition-opacity duration-200 ${imgLoaded ? 'opacity-100' : 'opacity-0'}`}
        />
      )}

      {/* 2. Platform Fallback Illustration (displayed when image is missing or failed) */}
      {(!imageUrl || imgError || !imgLoaded) && (
        <div className="absolute inset-0 flex items-center justify-center p-0.5 pointer-events-none">
          {isIos ? (
            isKnownTablet ? (
              <IPadIllustration className="w-full h-full" />
            ) : (
              <IPhoneIllustration className="w-full h-full" />
            )
          ) : isKnownTablet ? (
            <AndroidTabletIllustration className="w-full h-full" isVirtual={isVirtual} />
          ) : (
            <AndroidPhoneIllustration className="w-full h-full" isVirtual={isVirtual} />
          )}
        </div>
      )}
    </div>
  );
}
