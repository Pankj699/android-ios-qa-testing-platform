import React, { useState, useEffect } from 'react';
import { Package } from 'lucide-react';

const SIZE_MAP = {
  xs: 'w-5 h-5 min-w-[20px] min-h-[20px] rounded',
  sm: 'w-7 h-7 min-w-[28px] min-h-[28px] rounded-md',
  md: 'w-10 h-10 min-w-[40px] min-h-[40px] rounded-lg',
  lg: 'w-12 h-12 min-w-[48px] min-h-[48px] rounded-xl',
  xl: 'w-16 h-16 min-w-[64px] min-h-[64px] rounded-2xl'
};

const ICON_SIZE_MAP = {
  xs: 'w-3 h-3',
  sm: 'w-3.5 h-3.5',
  md: 'w-5 h-5',
  lg: 'w-6 h-6',
  xl: 'w-8 h-8'
};

/**
 * Universal Build & Application Icon Component
 * Renders the verified launcher icon extracted from uploaded APK/AAB builds
 * with graceful fallback to the styled Package icon.
 */
export default function BuildThumbnail({
  build,
  iconUrl,
  packageName,
  applicationName,
  size = 'md',
  className = '',
  alt
}) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);

  // Derive target URL
  const resolvedUrl = iconUrl ||
    build?.iconUrl ||
    (build?.id ? `/api/build/${build.id}/icon` : null) ||
    ((build?.packageName || packageName) ? `/api/app-icon/${encodeURIComponent(build?.packageName || packageName)}` : null);

  const appTitle = applicationName || build?.applicationName || build?.packageName || packageName || 'Application';
  const altText = alt || `${appTitle} icon`;

  // Reset error/loaded state if resolvedUrl changes
  useEffect(() => {
    setImgLoaded(false);
    setImgError(false);
  }, [resolvedUrl]);

  const sizeClass = SIZE_MAP[size] || SIZE_MAP.md;
  const iconSizeClass = ICON_SIZE_MAP[size] || ICON_SIZE_MAP.md;

  return (
    <div
      className={`relative inline-flex items-center justify-center shrink-0 overflow-hidden border border-[#1E2638] bg-[#0E131F] shadow-xs select-none ${sizeClass} ${className}`}
      title={appTitle}
    >
      {/* 1. Actual Extracted App Launcher Icon */}
      {resolvedUrl && !imgError && (
        <img
          src={resolvedUrl}
          alt={altText}
          loading="lazy"
          onLoad={() => setImgLoaded(true)}
          onError={() => setImgError(true)}
          className={`w-full h-full object-contain p-0.5 transition-opacity duration-200 ${imgLoaded ? 'opacity-100' : 'opacity-0'}`}
        />
      )}

      {/* 2. Platform Fallback Package Icon */}
      {(!resolvedUrl || imgError || !imgLoaded) && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-[#121824]">
          <Package className={`${iconSizeClass} text-[#F59E0B]`} />
        </div>
      )}
    </div>
  );
}
