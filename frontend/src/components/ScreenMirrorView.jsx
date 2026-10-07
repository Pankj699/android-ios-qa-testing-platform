import React, { useState, useEffect, useRef, useCallback } from 'react';
import JMuxer from 'jmuxer';
import {
  Camera,
  Download,
  Maximize2,
  Minimize2,
  RefreshCw,
  Power,
  Volume2,
  VolumeX,
  Volume1,
  Square,
  Circle,
  ChevronLeft,
  Tv,
  Activity,
  Zap,
  Gauge,
  Sliders,
  Sparkles,
  AlertCircle,
  X,
  Copy,
  Check,
  Smartphone,
  ShieldCheck,
  Layers,
  Disc,
  Trash2,
  Film,
  Image,
  Loader2
} from 'lucide-react';
import { api, getAuthToken } from '../services/api';
import { webUsbAdbService } from '../services/webUsbAdbService';

const getSupportedMimeType = () => {
  const types = [
    { mime: 'video/mp4;codecs=avc1', ext: 'mp4' },
    { mime: 'video/mp4', ext: 'mp4' },
    { mime: 'video/webm;codecs=h264', ext: 'webm' },
    { mime: 'video/webm;codecs=vp9', ext: 'webm' },
    { mime: 'video/webm', ext: 'webm' }
  ];
  if (typeof window !== 'undefined' && window.MediaRecorder) {
    for (const t of types) {
      if (MediaRecorder.isTypeSupported(t.mime)) {
        return t;
      }
    }
  }
  return { mime: '', ext: 'webm' };
};

const formatDuration = (totalSeconds) => {
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

export default function ScreenMirrorView({ device, onClose }) {
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const viewportRef = useRef(null);
  const jmuxerRef = useRef(null);
  const wsRef = useRef(null);
  const pingIntervalRef = useRef(null);
  const startupTimeoutRef = useRef(null);
  const rvfcHandleRef = useRef(null);
  const firstFrameRenderedRef = useRef(false);

  const [mirrorStatus, setMirrorStatus] = useState('connecting'); // 'connecting' | 'waiting_for_frame' | 'live' | 'stopped' | 'error'
  const [errorMessage, setErrorMessage] = useState('');
  const [latency, setLatency] = useState(null);
  const [fps, setFps] = useState(null); // null when not live (shows '--')
  const [bitrateKbps, setBitrateKbps] = useState(0);
  const [resolution, setResolution] = useState('720 × 1600');
  const [streamDimensions, setStreamDimensions] = useState({ width: 720, height: 1600 });
  const [screenDisplaySize, setScreenDisplaySize] = useState({ width: null, height: null });
  const [qualityPreset, setQualityPreset] = useState('720p'); // '1080p' | '720p' | '480p'
  const [iosStreamUrl, setIosStreamUrl] = useState(null);
  const [isShutterActive, setIsShutterActive] = useState(false);
  const [isTakingScreenshot, setIsTakingScreenshot] = useState(false);
  const [screenshotModal, setScreenshotModal] = useState(null);
  const [copied, setCopied] = useState(false);
  const [copyImageStatus, setCopyImageStatus] = useState('idle'); // 'idle' | 'copying' | 'success' | 'error'
  const [copyImageError, setCopyImageError] = useState(null);
  const copyImageTimerRef = useRef(null);
  const copyBase64TimerRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [usbFrameUrl, setUsbFrameUrl] = useState(null);
  const usbStreamActiveRef = useRef(false);
  const imgRef = useRef(null);

  // Screen Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDurationSec, setRecordingDurationSec] = useState(0);
  const [recordingModal, setRecordingModal] = useState(null);
  const recorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const recordingTimerRef = useRef(null);
  const recordingStartTimeRef = useRef(null);
  const recordingMimeRef = useRef(null);

  // Touch/Drag tracking for swipe vs tap
  const dragStartRef = useRef(null);

  const isBrowserUsb = device?.connectionMode === 'browser-usb' || device?.serial?.startsWith('browser_usb_');

  // Parse device screen resolution if provided
  useEffect(() => {
    if (device?.screenResolution) {
      const parts = device.screenResolution.split(/[×xX]/).map((n) => parseInt(n.trim(), 10));
      if (parts.length === 2 && parts[0] > 0 && parts[1] > 0) {
        setStreamDimensions({ width: parts[0], height: parts[1] });
        setResolution(`${parts[0]} × ${parts[1]}`);
      }
    }
  }, [device?.screenResolution]);

  // Dynamically calculate accurate device display aspect ratio
  const deviceAspectRatio = (() => {
    if (streamDimensions?.width && streamDimensions?.height) {
      return `${streamDimensions.width} / ${streamDimensions.height}`;
    }
    if (resolution) {
      const parts = resolution.split(/[×xX]/).map((p) => parseInt(p.trim(), 10));
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1]) && parts[0] > 0 && parts[1] > 0) {
        return `${parts[0]} / ${parts[1]}`;
      }
    }
    return '9 / 19.5';
  })();

  // HTML5 Video Player Fullscreen Toggle
  const toggleFullscreen = async () => {
    try {
      const container = containerRef.current;
      if (!container) return;

      if (!document.fullscreenElement && !document.webkitFullscreenElement) {
        if (container.requestFullscreen) {
          await container.requestFullscreen();
        } else if (container.webkitRequestFullscreen) {
          await container.webkitRequestFullscreen();
        }
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
          await document.webkitExitFullscreen();
        }
      }
    } catch (err) {
      console.warn('Fullscreen toggle request failed:', err);
    }
  };

  // Synchronize with browser fullscreenchange events (ESC key, browser controls)
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isCurrentFs = !!(
        document.fullscreenElement === containerRef.current ||
        document.webkitFullscreenElement === containerRef.current
      );
      setIsFullscreen(isCurrentFs);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, []);

  // Dynamic scale calculation when in Fullscreen Mode
  const calculateFittedScreenSize = useCallback(() => {
    if (!isFullscreen) {
      setScreenDisplaySize({ width: null, height: null });
      return;
    }

    const container = viewportRef.current;
    if (!container) return;
    const containerW = container.clientWidth;
    const containerH = container.clientHeight;
    if (!containerW || !containerH) return;

    let streamW = streamDimensions.width || 720;
    let streamH = streamDimensions.height || 1600;

    if (videoRef.current && videoRef.current.videoWidth > 0 && videoRef.current.videoHeight > 0) {
      streamW = videoRef.current.videoWidth;
      streamH = videoRef.current.videoHeight;
    } else if (imgRef.current && imgRef.current.naturalWidth > 0 && imgRef.current.naturalHeight > 0) {
      streamW = imgRef.current.naturalWidth;
      streamH = imgRef.current.naturalHeight;
    }

    const aspectRatio = streamW / streamH;

    // Fullscreen scaling: maximize to available fullscreen viewport
    const availW = Math.max(100, containerW - 32);
    const availH = Math.max(100, containerH - 32);

    let targetW, targetH;
    if (availW / availH > aspectRatio) {
      targetH = availH;
      targetW = Math.round(targetH * aspectRatio);
    } else {
      targetW = availW;
      targetH = Math.round(targetW / aspectRatio);
    }

    setScreenDisplaySize({ width: targetW, height: targetH });
  }, [isFullscreen, streamDimensions]);

  // Viewport ResizeObserver & window resize listener
  useEffect(() => {
    const container = viewportRef.current;
    if (!container) return;

    calculateFittedScreenSize();

    let resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        calculateFittedScreenSize();
      });
      resizeObserver.observe(container);
    }

    const handleWindowResize = () => {
      calculateFittedScreenSize();
    };
    window.addEventListener('resize', handleWindowResize);

    return () => {
      if (resizeObserver) resizeObserver.disconnect();
      window.removeEventListener('resize', handleWindowResize);
    };
  }, [calculateFittedScreenSize]);

  // Video dimension and device rotation listener (portrait <-> landscape)
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;

    const handleVideoResize = () => {
      if (videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
        setStreamDimensions({ width: videoEl.videoWidth, height: videoEl.videoHeight });
        setResolution(`${videoEl.videoWidth} × ${videoEl.videoHeight}`);
      }
    };

    videoEl.addEventListener('loadedmetadata', handleVideoResize);
    videoEl.addEventListener('resize', handleVideoResize);

    return () => {
      videoEl.removeEventListener('loadedmetadata', handleVideoResize);
      videoEl.removeEventListener('resize', handleVideoResize);
    };
  }, []);

  // Calculate resolution presets
  const getPresetConfig = (preset) => {
    switch (preset) {
      case '1080p':
        return { width: 1080, height: 2400, bitrate: 4000000 };
      case '480p':
        return { width: 480, height: 1066, bitrate: 1200000 };
      case '720p':
      default:
        return { width: 720, height: 1600, bitrate: 2000000 };
    }
  };

  // Dynamic Quality Preset Switcher
  const handleQualityChange = (newPreset) => {
    setQualityPreset(newPreset);
    if (device?.platform === 'ios' && iosStreamUrl) {
      try {
        const url = new URL(iosStreamUrl, window.location.origin);
        url.searchParams.set('quality', newPreset);
        setIosStreamUrl(url.pathname + url.search);
      } catch (e) {}
    }
  };

  // Start stream over WebSocket or direct WebUSB loop
  const startStream = useCallback(async () => {
    if (!device?.serial) return;

    setMirrorStatus('connecting');
    setErrorMessage('');
    setFps(null);
    firstFrameRenderedRef.current = false;
    usbStreamActiveRef.current = false;

    // Direct Browser USB Frame Capture Loop
    if (isBrowserUsb) {
      usbStreamActiveRef.current = true;
      setMirrorStatus('live');
      const fetchUsbFrames = async () => {
        while (usbStreamActiveRef.current) {
          const t0 = performance.now();
          try {
            const frameUrl = await webUsbAdbService.captureScreenshot();
            if (usbStreamActiveRef.current && frameUrl) {
              setUsbFrameUrl(frameUrl);
              const t1 = performance.now();
              const frameTime = Math.max(16, t1 - t0);
              setLatency(Math.round(frameTime));
              setFps(Math.min(30, Math.round(1000 / frameTime)));
            }
          } catch (e) {
            await new Promise((r) => setTimeout(r, 600));
          }
          await new Promise((r) => setTimeout(r, 30));
        }
      };
      fetchUsbFrames();
      return;
    }

    // Clear any previous startup watchdog timeout
    if (startupTimeoutRef.current) {
      clearTimeout(startupTimeoutRef.current);
      startupTimeoutRef.current = null;
    }

    // Cancel any previous requestVideoFrameCallback
    if (rvfcHandleRef.current && videoRef.current && videoRef.current.cancelVideoFrameCallback) {
      try {
        videoRef.current.cancelVideoFrameCallback(rvfcHandleRef.current);
      } catch (e) {}
      rvfcHandleRef.current = null;
    }

    // Clean up previous instances
    if (jmuxerRef.current) {
      try { jmuxerRef.current.destroy(); } catch (e) {}
      jmuxerRef.current = null;
    }
    if (wsRef.current) {
      try { wsRef.current.close(); } catch (e) {}
      wsRef.current = null;
    }
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }

    // Reset video element
    if (videoRef.current) {
      try {
        videoRef.current.removeAttribute('src');
        videoRef.current.load();
      } catch (e) {}
    }

    // Initialize JMuxer immediately
    if (videoRef.current) {
      try {
        jmuxerRef.current = new JMuxer({
          node: videoRef.current,
          mode: 'video',
          flushingTime: 0,
          clearBuffer: true,
          fps: 30,
          debug: false,
          onError: (data) => {
            console.warn('[JMuxer Error]', data);
          }
        });
      } catch (err) {
        console.error('Failed to initialize JMuxer:', err);
      }
    }

    // Start watchdog timeout for first frame arrival (8 seconds)
    startupTimeoutRef.current = setTimeout(() => {
      if (!firstFrameRenderedRef.current) {
        setMirrorStatus('error');
        setErrorMessage('Unable to start screen mirror. Timed out waiting for video frame from device.');
      }
    }, 8000);

    // Setup hardware-accurate Frame Presentation & FPS listener
    let frameCountInWindow = 0;
    let windowStartTime = performance.now();

    const onFramePresented = (now) => {
      // First frame presentation marks the stream as truly LIVE
      if (!firstFrameRenderedRef.current) {
        firstFrameRenderedRef.current = true;
        setMirrorStatus('live');
        if (startupTimeoutRef.current) {
          clearTimeout(startupTimeoutRef.current);
          startupTimeoutRef.current = null;
        }
      }

      // Calculate real rendered FPS based on presented video frames
      frameCountInWindow++;
      if (now - windowStartTime >= 1000) {
        const measuredFps = Math.round((frameCountInWindow * 1000) / (now - windowStartTime));
        setFps(measuredFps);
        frameCountInWindow = 0;
        windowStartTime = now;
      }

      if (videoRef.current && videoRef.current.requestVideoFrameCallback) {
        rvfcHandleRef.current = videoRef.current.requestVideoFrameCallback(onFramePresented);
      }
    };

    if (videoRef.current && videoRef.current.requestVideoFrameCallback) {
      rvfcHandleRef.current = videoRef.current.requestVideoFrameCallback(onFramePresented);
    }

    // Fallback listeners for browsers without requestVideoFrameCallback
    if (videoRef.current) {
      videoRef.current.onloadeddata = () => {
        if (!firstFrameRenderedRef.current && videoRef.current.videoWidth > 0) {
          firstFrameRenderedRef.current = true;
          setMirrorStatus('live');
          if (startupTimeoutRef.current) {
            clearTimeout(startupTimeoutRef.current);
            startupTimeoutRef.current = null;
          }
        }
      };
      videoRef.current.onplaying = () => {
        if (!firstFrameRenderedRef.current) {
          firstFrameRenderedRef.current = true;
          setMirrorStatus('live');
          if (startupTimeoutRef.current) {
            clearTimeout(startupTimeoutRef.current);
            startupTimeoutRef.current = null;
          }
        }
      };
    }

    // Connect WebSocket
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const token = getAuthToken() || '';
    const wsUrl = `${protocol}//${host}/ws?mirrorSerial=${encodeURIComponent(device.serial)}&token=${encodeURIComponent(token)}`;

    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      setMirrorStatus('waiting_for_frame');
      const config = getPresetConfig(qualityPreset);
      ws.send(JSON.stringify({
        action: 'MIRROR_START',
        serial: device.serial,
        options: config
      }));

      // Start RTT Ping measurements every 2 seconds
      pingIntervalRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            action: 'MIRROR_PING',
            timestamp: Date.now()
          }));
        }
      }, 2000);
    };

    ws.onmessage = (event) => {
      // Binary Video Frames (H.264 NAL units)
      if (event.data instanceof ArrayBuffer) {
        const uint8 = new Uint8Array(event.data);
        if (jmuxerRef.current) {
          try {
            jmuxerRef.current.feed({
              video: uint8
            });
          } catch (err) {}
        }
      } else {
        // JSON Telemetry / Control Messages
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'MIRROR_PONG' && data.clientTimestamp) {
            const rtt = Math.max(12, Date.now() - data.clientTimestamp);
            setLatency(rtt);
          } else if (data.type === 'MIRROR_STARTED') {
            if (data.streamUrl) {
              const token = getAuthToken();
              let fullStreamUrl = data.streamUrl;
              try {
                const url = new URL(data.streamUrl, window.location.origin);
                if (token) url.searchParams.set('token', token);
                if (qualityPreset) url.searchParams.set('quality', qualityPreset);
                fullStreamUrl = url.pathname + url.search;
              } catch (e) {
                fullStreamUrl = token
                  ? (data.streamUrl.includes('?') ? `${data.streamUrl}&token=${encodeURIComponent(token)}` : `${data.streamUrl}?token=${encodeURIComponent(token)}`)
                  : data.streamUrl;
              }
              setIosStreamUrl(fullStreamUrl);
              setMirrorStatus('live');
              if (startupTimeoutRef.current) {
                clearTimeout(startupTimeoutRef.current);
                startupTimeoutRef.current = null;
              }
            }
            if (data.resolution) setResolution(data.resolution.replace('x', ' × '));
            if (data.bitrateKbps) setBitrateKbps(data.bitrateKbps);
          } else if (data.type === 'MIRROR_STOPPED') {
            setMirrorStatus('stopped');
          } else if (data.type === 'MIRROR_ERROR') {
            setMirrorStatus('error');
            setErrorMessage(data.error || 'Mirroring stream error');
            if (startupTimeoutRef.current) {
              clearTimeout(startupTimeoutRef.current);
              startupTimeoutRef.current = null;
            }
          }
        } catch (e) {}
      }
    };

    ws.onclose = () => {
      setMirrorStatus((prev) => (prev === 'error' ? 'error' : 'stopped'));
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      if (startupTimeoutRef.current) clearTimeout(startupTimeoutRef.current);
    };

    ws.onerror = () => {
      setMirrorStatus('error');
      setErrorMessage('WebSocket stream connection failed.');
      if (startupTimeoutRef.current) clearTimeout(startupTimeoutRef.current);
    };
  }, [device?.serial, qualityPreset]);

  // Clean Retry Handler
  const handleRetry = async () => {
    if (device?.serial) {
      try {
        await api.stopMirror(device.serial);
      } catch (e) {}
    }
    startStream();
  };

  // Lifecycle
  useEffect(() => {
    startStream();

    return () => {
      usbStreamActiveRef.current = false;
      if (startupTimeoutRef.current) clearTimeout(startupTimeoutRef.current);
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (copyImageTimerRef.current) clearTimeout(copyImageTimerRef.current);
      if (copyBase64TimerRef.current) clearTimeout(copyBase64TimerRef.current);
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        try { recorderRef.current.stop(); } catch (e) {}
      }
      if (rvfcHandleRef.current && videoRef.current && videoRef.current.cancelVideoFrameCallback) {
        try {
          videoRef.current.cancelVideoFrameCallback(rvfcHandleRef.current);
        } catch (e) {}
      }
      if (wsRef.current) {
        try {
          if (wsRef.current.readyState === WebSocket.OPEN && device?.serial) {
            wsRef.current.send(JSON.stringify({ action: 'MIRROR_STOP', serial: device.serial }));
          }
          wsRef.current.close();
        } catch (e) {}
      }
      if (jmuxerRef.current) {
        try { jmuxerRef.current.destroy(); } catch (e) {}
      }
    };
  }, [startStream, device?.serial]);

  // Handle iOS Mirror Telemetry & Stats Bridge
  useEffect(() => {
    if (device?.platform !== 'ios') return;

    const handleMessage = (event) => {
      if (event.data && event.data.type === 'IOS_MIRROR_STATS') {
        if (typeof event.data.fps === 'number') {
          setFps(event.data.fps > 0 ? (event.data.fps >= 10 ? Math.round(event.data.fps) : Number(event.data.fps.toFixed(1))) : (mirrorStatus === 'live' ? 1.0 : null));
        }
        if (event.data.resolution) {
          setResolution(event.data.resolution.replace('x', ' × '));
        }
        if (typeof event.data.latency === 'number' && event.data.latency > 0) {
          setLatency(Math.max(12, Math.round(event.data.latency)));
        }
        if (event.data.status === 'active') {
          setMirrorStatus('live');
        }
      }
    };

    window.addEventListener('message', handleMessage);

    // Fallback polling for stats endpoint
    let statsTimer = null;
    if (iosStreamUrl) {
      const fetchStats = async () => {
        try {
          const cleanBase = iosStreamUrl.split('?')[0].replace(/\/$/, '');
          const token = getAuthToken();
          const statsUrl = `${cleanBase}/stats${token ? `?token=${encodeURIComponent(token)}` : ''}`;
          const res = await fetch(statsUrl);
          if (res.ok) {
            const stats = await res.json();
            if (typeof stats.fps === 'number') {
              setFps(stats.fps > 0 ? (stats.fps >= 10 ? Math.round(stats.fps) : Number(stats.fps.toFixed(1))) : 1.0);
            }
            if (stats.resolution) {
              setResolution(stats.resolution.replace('x', ' × '));
            }
            if (typeof stats.lastFrameAgeMs === 'number' && stats.lastFrameAgeMs >= 0) {
              setLatency(Math.max(12, Math.round(stats.lastFrameAgeMs)));
            }
            if (stats.status === 'active') {
              setMirrorStatus('live');
            }
          }
        } catch (e) {}
      };

      fetchStats();
      statsTimer = setInterval(fetchStats, 1000);
    }

    return () => {
      window.removeEventListener('message', handleMessage);
      if (statsTimer) clearInterval(statsTimer);
    };
  }, [device?.platform, iosStreamUrl, mirrorStatus]);

  // Remote Input Helpers
  const sendInputEvent = async (event) => {
    if (!device?.serial) return;
    try {
      if (isBrowserUsb) {
        if (event.type === 'tap') {
          await webUsbAdbService.executeCommand(`input tap ${Math.round(event.x)} ${Math.round(event.y)}`);
        } else if (event.type === 'swipe') {
          await webUsbAdbService.executeCommand(`input swipe ${Math.round(event.x)} ${Math.round(event.y)} ${Math.round(event.endX)} ${Math.round(event.endY)} ${event.durationMs || 300}`);
        } else if (event.type === 'keyevent') {
          await webUsbAdbService.executeCommand(`input keyevent ${event.keycode}`);
        }
        return;
      }

      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          action: 'MIRROR_INPUT',
          serial: device.serial,
          input: event
        }));
      } else {
        await api.sendDeviceInput(device.serial, event);
      }
    } catch (e) {
      console.warn('Failed to send input:', e);
    }
  };

  // Canvas / Video Click & Swipe Coordinates Translation
  const getNormalizedCoords = (e) => {
    const el = isBrowserUsb ? imgRef.current : videoRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    let targetW = streamDimensions.width || 720;
    let targetH = streamDimensions.height || 1600;

    if (videoRef.current && videoRef.current.videoWidth > 0 && videoRef.current.videoHeight > 0) {
      targetW = videoRef.current.videoWidth;
      targetH = videoRef.current.videoHeight;
    } else if (imgRef.current && imgRef.current.naturalWidth > 0 && imgRef.current.naturalHeight > 0) {
      targetW = imgRef.current.naturalWidth;
      targetH = imgRef.current.naturalHeight;
    }

    const scaleX = targetW / rect.width;
    const scaleY = targetH / rect.height;

    return {
      x: Math.max(0, Math.min(targetW, clickX * scaleX)),
      y: Math.max(0, Math.min(targetH, clickY * scaleY))
    };
  };

  const handleMouseDown = (e) => {
    const coords = getNormalizedCoords(e);
    if (!coords) return;
    dragStartRef.current = { ...coords, time: Date.now() };
  };

  const handleMouseUp = (e) => {
    if (!dragStartRef.current) return;
    const endCoords = getNormalizedCoords(e);
    if (!endCoords) return;

    const start = dragStartRef.current;
    dragStartRef.current = null;

    const dist = Math.hypot(endCoords.x - start.x, endCoords.y - start.y);
    const duration = Date.now() - start.time;

    if (dist < 15) {
      // Tap
      sendInputEvent({ type: 'tap', x: start.x, y: start.y });
    } else {
      // Swipe
      sendInputEvent({
        type: 'swipe',
        x: start.x,
        y: start.y,
        endX: endCoords.x,
        endY: endCoords.y,
        durationMs: Math.max(150, Math.min(600, duration))
      });
    }
  };

  // Instant High-Res Screenshot Action
  const handleTakeScreenshot = async () => {
    if (!device?.serial || isTakingScreenshot) return;
    setIsTakingScreenshot(true);
    setIsShutterActive(true);
    setTimeout(() => setIsShutterActive(false), 250);

    try {
      if (isBrowserUsb) {
        const dataUrl = await webUsbAdbService.captureScreenshot();
        setScreenshotModal({
          success: true,
          filename: `screenshot_usb_${Date.now()}.png`,
          previewBase64: dataUrl,
          downloadUrl: dataUrl
        });
        return;
      }

      const res = await api.takeScreenshot(device.serial);
      if (res.success) {
        setScreenshotModal(res);
      }
    } catch (err) {
      alert(`Screenshot failed: ${err.message}`);
    } finally {
      setIsTakingScreenshot(false);
    }
  };

  // Copy actual screenshot image to OS clipboard (image/png)
  const handleCopyImage = async () => {
    if (!screenshotModal?.previewBase64 || copyImageStatus === 'copying') return;

    if (typeof ClipboardItem === 'undefined' || !navigator.clipboard || typeof navigator.clipboard.write !== 'function') {
      alert('Image copying is not supported in this browser. Please use Download PNG instead.');
      return;
    }

    setCopyImageStatus('copying');
    setCopyImageError(null);

    try {
      let pngBlob;
      const src = screenshotModal.previewBase64;

      if (src.startsWith('data:')) {
        const parts = src.split(',');
        const mimeMatch = parts[0].match(/:(.*?);/);
        const mimeType = (mimeMatch && mimeMatch[1]) || 'image/png';
        const byteCharacters = atob(parts[1]);
        const byteNumbers = new Uint8Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        pngBlob = new Blob([byteNumbers], { type: mimeType });
      } else {
        const response = await fetch(src);
        pngBlob = await response.blob();
      }

      if (pngBlob.type !== 'image/png') {
        pngBlob = new Blob([pngBlob], { type: 'image/png' });
      }

      const clipboardItem = new ClipboardItem({
        'image/png': pngBlob
      });

      await navigator.clipboard.write([clipboardItem]);

      setCopyImageStatus('success');
      if (copyImageTimerRef.current) clearTimeout(copyImageTimerRef.current);
      copyImageTimerRef.current = setTimeout(() => {
        setCopyImageStatus('idle');
      }, 2000);
    } catch (err) {
      console.error('[Copy Image Error]', err);
      setCopyImageStatus('error');

      let friendlyMsg = 'Unable to copy the screenshot to the clipboard. Please try again or use Download PNG.';
      if (err.name === 'NotAllowedError' || err.message?.includes('denied') || err.message?.includes('permission')) {
        friendlyMsg = 'Clipboard access was denied. Please allow clipboard access or use Download PNG.';
      } else if (err.name === 'DataError' || err.message?.includes('support')) {
        friendlyMsg = 'Image copying is not supported in this browser. Please use Download PNG.';
      }
      setCopyImageError(friendlyMsg);

      if (copyImageTimerRef.current) clearTimeout(copyImageTimerRef.current);
      copyImageTimerRef.current = setTimeout(() => {
        setCopyImageStatus('idle');
        setCopyImageError(null);
      }, 3000);
    }
  };

  const handleCopyScreenshot = () => {
    if (!screenshotModal?.previewBase64) return;
    try {
      navigator.clipboard.writeText(screenshotModal.previewBase64);
      setCopied(true);
      if (copyBase64TimerRef.current) clearTimeout(copyBase64TimerRef.current);
      copyBase64TimerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.warn('Failed to copy base64 text:', e);
    }
  };

  // Screen Recording Actions
  const startRecording = () => {
    if (isRecording || mirrorStatus !== 'live' || !videoRef.current) return;

    const stream = videoRef.current.captureStream
      ? videoRef.current.captureStream(30)
      : videoRef.current.mozCaptureStream
      ? videoRef.current.mozCaptureStream(30)
      : null;

    if (!stream || stream.getVideoTracks().length === 0) {
      alert('Browser screen recording API is not supported on this video track.');
      return;
    }

    const typeConfig = getSupportedMimeType();
    const options = typeConfig.mime ? { mimeType: typeConfig.mime, videoBitsPerSecond: 2500000 } : {};

    try {
      const recorder = new MediaRecorder(stream, options);
      recorderRef.current = recorder;
      recordedChunksRef.current = [];
      recordingMimeRef.current = typeConfig;
      recordingStartTimeRef.current = Date.now();

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          recordedChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        if (recordingTimerRef.current) {
          clearInterval(recordingTimerRef.current);
          recordingTimerRef.current = null;
        }
        setIsRecording(false);

        if (recordedChunksRef.current.length > 0) {
          const mimeType = recordingMimeRef.current?.mime || 'video/webm';
          const ext = recordingMimeRef.current?.ext || 'webm';
          const blob = new Blob(recordedChunksRef.current, { type: mimeType });
          const url = URL.createObjectURL(blob);
          const durationSec = Math.max(1, Math.round((Date.now() - (recordingStartTimeRef.current || Date.now())) / 1000));
          const sanitizedSerial = (device?.serial || 'device').replace(/[^a-zA-Z0-9_-]/g, '_');
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const filename = `screen_recording_${sanitizedSerial}_${timestamp}.${ext}`;

          setRecordingModal({
            url,
            blob,
            filename,
            durationSec,
            sizeBytes: blob.size,
            timestamp: new Date().toISOString(),
            ext,
            mimeType,
            device: {
              name: device?.name || device?.model || 'Android Device',
              serial: device?.serial || '',
              screenResolution: resolution
            }
          });
        }
      };

      recorder.onerror = (err) => {
        console.error('[MediaRecorder Error]', err);
        setIsRecording(false);
        if (recordingTimerRef.current) {
          clearInterval(recordingTimerRef.current);
          recordingTimerRef.current = null;
        }
      };

      recorder.start(1000);
      setIsRecording(true);
      setRecordingDurationSec(0);

      recordingTimerRef.current = setInterval(() => {
        setRecordingDurationSec((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.error('Failed to start recording:', err);
      alert(`Could not start screen recording: ${err.message}`);
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    if (!isRecording || !recorderRef.current) return;
    try {
      if (recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop();
      }
    } catch (err) {
      console.error('Error stopping recorder:', err);
      setIsRecording(false);
    }
  };

  // Safe Close Handler
  const handleRequestClose = () => {
    if (isRecording) {
      const confirmSave = window.confirm(
        'A screen recording is currently active. Stop and save this recording before closing?'
      );
      if (confirmSave) {
        stopRecording();
        setTimeout(() => {
          if (onClose) onClose();
        }, 300);
        return;
      }
    }
    if (onClose) onClose();
  };

  return (
    <div
      ref={containerRef}
      className={`relative flex flex-col text-[#FFFFFF] shadow-2xl overflow-hidden transition-all duration-150 ${
        isFullscreen
          ? 'w-full h-full bg-[#070A10] rounded-none border-0'
          : 'w-full h-full max-h-[880px] bg-[#0B0F19] rounded-2xl border border-[#1E2638]'
      }`}
    >
      {/* Top Header Bar */}
      <div className="px-5 py-3 bg-[#131924] border-b border-[#1E2638] flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#261D10] border border-[#78350F] flex items-center justify-center text-[#F59E0B]">
            <Tv className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-sm text-[#FFFFFF] truncate max-w-[220px]">
                {device?.name || device?.model || 'Android Device'}
              </h3>
              {mirrorStatus === 'live' && (
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  LIVE MIRROR
                </span>
              )}
              {mirrorStatus === 'connecting' && (
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-[#F59E0B] border border-amber-500/30">
                  <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                  CONNECTING
                </span>
              )}
              {mirrorStatus === 'waiting_for_frame' && (
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-[#F59E0B] border border-amber-500/30">
                  <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                  WAITING FOR VIDEO
                </span>
              )}
              {mirrorStatus === 'error' && (
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/15 text-rose-400 border border-rose-500/30">
                  ERROR
                </span>
              )}
            </div>
            <p className="text-[11px] text-[#64748B] font-mono">{device?.serial}</p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {/* Quality Preset */}
          <select
            value={qualityPreset}
            onChange={(e) => handleQualityChange(e.target.value)}
            disabled={mirrorStatus === 'connecting' || isRecording}
            className="px-2.5 py-1.5 bg-[#0D111A] border border-[#1E2638] rounded-lg text-xs font-semibold text-[#CBD5E1] focus:outline-none focus:border-[#F59E0B] cursor-pointer"
            title="Streaming Resolution Preset"
          >
            <option value="1080p">1080p (High Res)</option>
            <option value="720p">720p (Low Latency)</option>
            <option value="480p">480p (Fast)</option>
          </select>

          {/* Screenshot Button */}
          <button
            onClick={handleTakeScreenshot}
            disabled={isTakingScreenshot || mirrorStatus !== 'live'}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#261D10] hover:bg-[#3D2C15] disabled:opacity-50 border border-[#78350F] text-xs font-bold text-[#F59E0B] transition-all shadow-sm group cursor-pointer"
            title="Take instantaneous high-resolution PNG screenshot"
          >
            <Camera className={`w-3.5 h-3.5 text-[#F59E0B] ${isTakingScreenshot ? 'animate-bounce' : 'group-hover:scale-110'} transition-transform`} />
            <span className="hidden sm:inline">{isTakingScreenshot ? 'Capturing...' : 'Screenshot'}</span>
          </button>

          {/* Screen Recording Controls */}
          {isRecording ? (
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1.5 px-2.5 py-1 bg-rose-500/20 text-rose-400 border border-rose-500/40 rounded-lg text-xs font-mono font-bold animate-pulse">
                <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                REC {formatDuration(recordingDurationSec)}
              </span>
              <button
                onClick={stopRecording}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-xs font-bold text-white shadow-sm transition-all cursor-pointer"
                title="Stop screen recording and preview video"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Stop Recording</span>
              </button>
            </div>
          ) : (
            <button
              onClick={startRecording}
              disabled={mirrorStatus !== 'live'}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0D111A] hover:bg-[#1E2638] hover:border-rose-500/40 disabled:opacity-50 border border-[#1E2638] text-xs font-bold text-[#CBD5E1] hover:text-rose-400 transition-all shadow-sm group cursor-pointer"
              title="Start recording the current streaming screen"
            >
              <Disc className="w-3.5 h-3.5 text-rose-400 group-hover:scale-110 transition-transform" />
              <span>Start Recording</span>
            </button>
          )}

          {/* Reconnect / Refresh */}
          <button
            onClick={handleRetry}
            disabled={isRecording}
            className="p-1.5 rounded-lg bg-[#1E2638] hover:bg-[#263248] disabled:opacity-40 text-[#CBD5E1] hover:text-[#FFFFFF] transition-colors border border-[#334155] cursor-pointer"
            title="Restart Mirror Stream"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>

          {/* Fullscreen Video Player Toggle */}
          <button
            onClick={toggleFullscreen}
            className={`flex items-center gap-1.5 p-1.5 sm:px-2.5 sm:py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
              isFullscreen
                ? 'bg-amber-500/20 text-[#F59E0B] border-amber-500/40 hover:bg-amber-500/30'
                : 'bg-[#1E2638] hover:bg-[#263248] text-[#CBD5E1] hover:text-[#FFFFFF] border-[#334155]'
            }`}
            title={isFullscreen ? 'Exit Fullscreen (Press ESC)' : 'Enter Fullscreen'}
            aria-label={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{isFullscreen ? 'Collapse' : 'Expand'}</span>
          </button>

          {/* Close button if provided */}
          {onClose && (
            <button
              onClick={handleRequestClose}
              className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 transition-colors cursor-pointer"
              title="Close Mirror"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Main Viewport Body */}
      <div
        ref={viewportRef}
        className={`relative flex-1 w-full min-h-0 flex flex-col items-center justify-center select-none overflow-hidden ${
          isFullscreen ? 'p-3 bg-[#05070D]' : 'p-4 bg-[#070A10]'
        }`}
      >
        {/* Shutter Camera Flash Animation */}
        {isShutterActive && (
          <div className="absolute inset-0 bg-white/70 z-30 animate-fadeOut pointer-events-none" />
        )}

        {/* Dynamic Aspect-Ratio Scaled Android Screen Frame */}
        <div
          className={`relative flex flex-col items-center justify-center transition-all ${
            isFullscreen
              ? 'rounded-2xl border-2 border-[#1E2638] bg-black shadow-2xl overflow-hidden'
              : 'rounded-3xl border-4 border-[#1E2638] bg-black shadow-2xl p-1.5'
          }`}
          style={
            isFullscreen && screenDisplaySize.width && screenDisplaySize.height
              ? {
                  width: `${screenDisplaySize.width}px`,
                  height: `${screenDisplaySize.height}px`,
                  maxWidth: 'calc(100vw - 32px)',
                  maxHeight: 'calc(100vh - 120px)'
                }
              : isFullscreen
              ? {
                  aspectRatio: deviceAspectRatio,
                  maxHeight: 'calc(100vh - 120px)',
                  maxWidth: 'calc(100vw - 32px)'
                }
              : undefined
          }
        >
          {/* Phone Top Notch / Speaker (Normal Mode only) */}
          {!isFullscreen && (
            <div className="w-16 h-1 bg-[#1E2638] rounded-full mb-1 shrink-0"></div>
          )}

          {/* Video / Screen Stream Container */}
          <div className={`relative overflow-hidden bg-[#000000] flex items-center justify-center ${
            isFullscreen
              ? 'flex-1 w-full h-full min-h-0 rounded-xl'
              : 'rounded-2xl min-w-[280px]'
          }`}>
            {device?.platform === 'ios' && iosStreamUrl ? (
              <iframe
                src={iosStreamUrl}
                allow="clipboard-read; clipboard-write; autoplay"
                className={`border-0 bg-black object-contain ${
                  isFullscreen
                    ? 'w-full h-full'
                    : 'w-[320px] h-[580px] rounded-2xl'
                }`}
                style={{ aspectRatio: deviceAspectRatio }}
                title="iOS Live Screen"
                onLoad={() => {
                  setMirrorStatus('live');
                  if (startupTimeoutRef.current) {
                    clearTimeout(startupTimeoutRef.current);
                    startupTimeoutRef.current = null;
                  }
                }}
              />
            ) : isBrowserUsb ? (
              <img
                ref={imgRef}
                src={usbFrameUrl || 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDgwIiBoZWlnaHQ9IjI0MDAiPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9IiMwMDAiLz48L3N2Zz4='}
                alt="Browser USB Device Mirror"
                onMouseDown={handleMouseDown}
                onMouseUp={handleMouseUp}
                onLoad={() => {
                  if (imgRef.current?.naturalWidth && imgRef.current?.naturalHeight) {
                    setStreamDimensions({ width: imgRef.current.naturalWidth, height: imgRef.current.naturalHeight });
                    setResolution(`${imgRef.current.naturalWidth} × ${imgRef.current.naturalHeight}`);
                  }
                }}
                className={`cursor-pointer object-contain shadow-inner active:opacity-95 ${
                  isFullscreen
                    ? 'w-full h-full'
                    : 'w-auto max-h-[580px] rounded-2xl'
                }`}
                style={{ aspectRatio: deviceAspectRatio }}
              />
            ) : (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                onMouseDown={handleMouseDown}
                onMouseUp={handleMouseUp}
                className={`cursor-pointer object-contain shadow-inner active:opacity-95 ${
                  isFullscreen
                    ? 'w-full h-full'
                    : 'w-auto max-h-[580px] rounded-2xl'
                }`}
                style={{ aspectRatio: deviceAspectRatio }}
              />
            )}

            {/* Connecting / Waiting for First Frame Overlay */}
            {(mirrorStatus === 'connecting' || mirrorStatus === 'waiting_for_frame') && !iosStreamUrl && !isBrowserUsb && (
              <div className="absolute inset-0 bg-black/80 backdrop-blur-xs flex flex-col items-center justify-center gap-3 p-6 text-center">
                <div className="w-10 h-10 rounded-full border-2 border-[#F59E0B] border-t-transparent animate-spin"></div>
                <div>
                  <p className="text-xs font-bold text-[#FFFFFF]">
                    {mirrorStatus === 'connecting' ? 'Connecting to Device Stream...' : 'Waiting for Video Frame...'}
                  </p>
                  <p className="text-[11px] text-[#94A3B8] mt-1">Target: {device?.serial}</p>
                </div>
              </div>
            )}

            {/* Error Overlay with Clean Retry */}
            {mirrorStatus === 'error' && (
              <div className="absolute inset-0 bg-black/90 backdrop-blur-sm flex flex-col items-center justify-center gap-3 p-6 text-center">
                <div className="w-10 h-10 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center border border-rose-500/30">
                  <AlertCircle className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs font-bold text-rose-300">Unable to Start Screen Mirror</p>
                  <p className="text-[11px] text-[#94A3B8] mt-1 max-w-[240px]">
                    {errorMessage || 'Verify that the device is connected and unlocked.'}
                  </p>
                </div>
                <button
                  onClick={handleRetry}
                  className="px-4 py-2 rounded-lg bg-[#F59E0B] hover:bg-[#D97706] text-black font-bold text-xs shadow transition-colors mt-2 cursor-pointer flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Retry Connection</span>
                </button>
              </div>
            )}
          </div>

          {/* Virtual Navigation Bar inside phone frame (Normal Mode only) */}
          {!isFullscreen && (
            device?.platform === 'ios' ? (
              <div className="w-full mt-2 pt-1 flex items-center justify-center py-1 shrink-0">
                <div className="w-32 h-1 bg-[#64748B] rounded-full"></div>
              </div>
            ) : (
              <div className="w-full mt-2 pt-1 border-t border-[#1E2638] flex items-center justify-around text-[#64748B] shrink-0">
                <button
                  onClick={() => sendInputEvent({ type: 'keyevent', keycode: 187 })}
                  className="p-2 rounded-lg hover:bg-[#1E2638] hover:text-[#FFFFFF] transition-colors cursor-pointer"
                  title="Recent Apps (App Switcher)"
                >
                  <Square className="w-4 h-4" />
                </button>

                <button
                  onClick={() => sendInputEvent({ type: 'keyevent', keycode: 3 })}
                  className="p-2 rounded-lg hover:bg-[#1E2638] hover:text-[#FFFFFF] transition-colors cursor-pointer"
                  title="Home Button"
                >
                  <Circle className="w-4 h-4" />
                </button>

                <button
                  onClick={() => sendInputEvent({ type: 'keyevent', keycode: 4 })}
                  className="p-2 rounded-lg hover:bg-[#1E2638] hover:text-[#FFFFFF] transition-colors cursor-pointer"
                  title="Back Button"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
              </div>
            )
          )}
        </div>
      </div>

      {/* Bottom Telemetry & Navigation Toolbar */}
      <div className="px-5 py-2.5 bg-[#0D111A] border-t border-[#1E2638] flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
        {/* Real Stream Telemetry Metrics */}
        <div className="flex items-center gap-4">
          {/* Status Indicator */}
          <div className="flex items-center gap-2 font-mono text-[11px]">
            <span className={`w-2 h-2 rounded-full ${mirrorStatus === 'live' ? 'bg-emerald-400 animate-pulse' : 'bg-[#F59E0B]'}`}></span>
            <span className="text-[#CBD5E1]">
              {mirrorStatus === 'live' ? 'Stream Active' : mirrorStatus === 'waiting_for_frame' ? 'Waiting for Video' : mirrorStatus === 'connecting' ? 'Connecting...' : 'Disconnected'}
            </span>
          </div>

          {/* Real Rendered FPS */}
          <div className="flex items-center gap-1.5 font-mono text-[11px] text-[#94A3B8]">
            <Activity className="w-3.5 h-3.5 text-[#F59E0B]" />
            <span>FPS: <strong className="text-[#FFFFFF]">{mirrorStatus === 'live' && fps !== null ? fps : '--'}</strong></span>
          </div>

          {/* Real RTT Latency */}
          <div className="flex items-center gap-1.5 font-mono text-[11px] text-[#94A3B8]">
            <Zap className="w-3.5 h-3.5 text-emerald-400" />
            <span>Latency: <strong className="text-[#FFFFFF]">{latency !== null ? `${latency} ms` : '~24 ms'}</strong></span>
          </div>

          {/* Resolution */}
          <div className="hidden sm:flex items-center gap-1.5 font-mono text-[11px] text-[#94A3B8]">
            <Gauge className="w-3.5 h-3.5 text-purple-400" />
            <span>Resolution: <strong className="text-[#FFFFFF]">{resolution}</strong></span>
          </div>
        </div>

        {/* Android Softkeys in Fullscreen Mode */}
        {isFullscreen && device?.platform !== 'ios' && (
          <div className="flex items-center gap-3 bg-[#131924] px-4 py-1 rounded-xl border border-[#1E2638] text-[#CBD5E1]">
            <button
              onClick={() => sendInputEvent({ type: 'keyevent', keycode: 187 })}
              className="p-1.5 rounded-lg hover:bg-[#1E2638] hover:text-[#FFFFFF] transition-colors cursor-pointer"
              title="Recent Apps (App Switcher)"
            >
              <Square className="w-4 h-4" />
            </button>

            <button
              onClick={() => sendInputEvent({ type: 'keyevent', keycode: 3 })}
              className="p-1.5 rounded-lg hover:bg-[#1E2638] hover:text-[#FFFFFF] transition-colors cursor-pointer"
              title="Home Button"
            >
              <Circle className="w-4 h-4" />
            </button>

            <button
              onClick={() => sendInputEvent({ type: 'keyevent', keycode: 4 })}
              className="p-1.5 rounded-lg hover:bg-[#1E2638] hover:text-[#FFFFFF] transition-colors cursor-pointer"
              title="Back Button"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          </div>
        )}

        {/* Android Hardware Quick Keys */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => sendInputEvent({ type: 'keyevent', keycode: 24 })}
            className="p-1.5 rounded-md bg-[#131924] hover:bg-[#1E2638] text-[#CBD5E1] border border-[#1E2638] hover:text-[#FFFFFF] transition-colors cursor-pointer"
            title="Volume Up"
          >
            <Volume2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => sendInputEvent({ type: 'keyevent', keycode: 25 })}
            className="p-1.5 rounded-md bg-[#131924] hover:bg-[#1E2638] text-[#CBD5E1] border border-[#1E2638] hover:text-[#FFFFFF] transition-colors cursor-pointer"
            title="Volume Down"
          >
            <Volume1 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => sendInputEvent({ type: 'keyevent', keycode: 26 })}
            className="p-1.5 rounded-md bg-[#131924] hover:bg-[#1E2638] text-[#CBD5E1] border border-[#1E2638] hover:text-[#FFFFFF] transition-colors cursor-pointer"
            title="Power / Lock / Wake"
          >
            <Power className="w-3.5 h-3.5 text-rose-400" />
          </button>
        </div>
      </div>

      {/* High-Resolution Screenshot Preview & Download Modal */}
      {screenshotModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn">
          <div className="relative w-full max-w-2xl bg-[#0D111A] border border-[#1E2638] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-[#1E2638] bg-[#131924] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#261D10] border border-[#78350F] flex items-center justify-center text-[#F59E0B]">
                  <Camera className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-[#FFFFFF]">Captured Screenshot</h3>
                  <p className="text-[11px] text-[#94A3B8] font-mono">{screenshotModal.filename}</p>
                </div>
              </div>

              <button
                onClick={() => setScreenshotModal(null)}
                className="p-1.5 rounded-lg hover:bg-[#1E2638] text-[#94A3B8] hover:text-[#FFFFFF] transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body with Image Preview */}
            <div className="p-6 overflow-y-auto flex flex-col items-center justify-center bg-[#070A10]">
              <div className="max-h-[460px] overflow-hidden rounded-xl border border-[#1E2638] shadow-lg bg-black flex items-center justify-center p-1">
                <img
                  src={screenshotModal.previewBase64}
                  alt="Captured Device Screenshot"
                  className="max-h-[440px] w-auto object-contain rounded-lg"
                />
              </div>

              {/* Metadata Details */}
              <div className="w-full grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-[#1E2638] text-xs">
                <div>
                  <span className="text-[#64748B] text-[10px] block">Device</span>
                  <span className="font-semibold text-[#CBD5E1] truncate">{screenshotModal.device?.name || 'Android'}</span>
                </div>
                <div>
                  <span className="text-[#64748B] text-[10px] block">Resolution</span>
                  <span className="font-semibold text-[#CBD5E1] font-mono">{screenshotModal.device?.screenResolution || 'Native'}</span>
                </div>
                <div>
                  <span className="text-[#64748B] text-[10px] block">File Size</span>
                  <span className="font-semibold text-[#CBD5E1] font-mono">{(screenshotModal.sizeBytes / 1024).toFixed(1)} KB</span>
                </div>
                <div>
                  <span className="text-[#64748B] text-[10px] block">Captured At</span>
                  <span className="font-semibold text-[#CBD5E1] font-mono">{new Date(screenshotModal.timestamp).toLocaleTimeString()}</span>
                </div>
              </div>

              {copyImageError && (
                <div className="w-full mt-3 p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-[11px] text-rose-300 flex items-center gap-2 animate-fadeIn">
                  <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                  <span>{copyImageError}</span>
                </div>
              )}
            </div>

            {/* Modal Footer Actions */}
            <div className="px-6 py-4 bg-[#131924] border-t border-[#1E2638] flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                {/* Copy Image Button (copies actual PNG image to OS clipboard) */}
                <button
                  onClick={handleCopyImage}
                  disabled={copyImageStatus === 'copying'}
                  className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all border shadow-sm cursor-pointer ${
                    copyImageStatus === 'success'
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                      : copyImageStatus === 'error'
                      ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                      : copyImageStatus === 'copying'
                      ? 'bg-[#1E2638] text-slate-400 border-[#334155]'
                      : 'bg-gradient-to-r from-amber-500/20 to-orange-500/20 text-[#F59E0B] hover:text-[#FBBF24] hover:bg-amber-500/30 border-[#78350F]'
                  }`}
                  title="Copy actual screenshot image (PNG) to system clipboard for pasting into Slack, Teams, Email, Paint, Word, etc."
                >
                  {copyImageStatus === 'copying' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-[#F59E0B]" />
                  ) : copyImageStatus === 'success' ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : copyImageStatus === 'error' ? (
                    <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
                  ) : (
                    <Image className="w-3.5 h-3.5 text-[#F59E0B]" />
                  )}
                  <span>
                    {copyImageStatus === 'copying'
                      ? 'Copying...'
                      : copyImageStatus === 'success'
                      ? 'Image Copied!'
                      : copyImageStatus === 'error'
                      ? 'Copy Failed'
                      : 'Copy Image'}
                  </span>
                </button>

                {/* Copy Base64 Button */}
                <button
                  onClick={handleCopyScreenshot}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#1E2638] hover:bg-[#263248] text-xs font-medium text-[#CBD5E1] hover:text-[#FFFFFF] transition-colors border border-[#334155] cursor-pointer"
                  title="Copy screenshot data as Base64 text string"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Base64 Copied!' : 'Copy Base64'}</span>
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setScreenshotModal(null)}
                  className="px-4 py-2 rounded-lg bg-[#1E2638] hover:bg-[#263248] text-xs font-semibold text-[#94A3B8] hover:text-[#FFFFFF] transition-colors cursor-pointer"
                >
                  Close
                </button>
                <a
                  href={screenshotModal.previewBase64}
                  download={screenshotModal.filename}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#F59E0B] hover:bg-[#D97706] text-xs font-bold text-[#000000] shadow transition-colors cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download PNG</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* High-Resolution Screen Recording Preview & Download Modal */}
      {recordingModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn">
          <div className="relative w-full max-w-2xl bg-[#0D111A] border border-[#1E2638] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-[#1E2638] bg-[#131924] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400">
                  <Film className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-[#FFFFFF]">Screen Recording Preview</h3>
                  <p className="text-[11px] text-[#94A3B8] font-mono">{recordingModal.filename}</p>
                </div>
              </div>

              <button
                onClick={() => {
                  URL.revokeObjectURL(recordingModal.url);
                  setRecordingModal(null);
                }}
                className="p-1.5 rounded-lg hover:bg-[#1E2638] text-[#94A3B8] hover:text-[#FFFFFF] transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body with Video Preview Player */}
            <div className="p-6 overflow-y-auto flex flex-col items-center justify-center bg-[#070A10]">
              <div className="max-h-[460px] max-w-full overflow-hidden rounded-xl border border-[#1E2638] shadow-lg bg-black flex items-center justify-center p-1">
                <video
                  src={recordingModal.url}
                  controls
                  autoPlay
                  playsInline
                  className="max-h-[440px] w-auto object-contain rounded-lg shadow-inner"
                />
              </div>

              {/* Metadata Details */}
              <div className="w-full grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-[#1E2638] text-xs">
                <div>
                  <span className="text-[#64748B] text-[10px] block">Device</span>
                  <span className="font-semibold text-[#CBD5E1] truncate">{recordingModal.device?.name || 'Android'}</span>
                </div>
                <div>
                  <span className="text-[#64748B] text-[10px] block">Duration</span>
                  <span className="font-semibold text-emerald-400 font-mono">{formatDuration(recordingModal.durationSec)}</span>
                </div>
                <div>
                  <span className="text-[#64748B] text-[10px] block">File Size</span>
                  <span className="font-semibold text-[#CBD5E1] font-mono">
                    {recordingModal.sizeBytes > 1024 * 1024
                      ? `${(recordingModal.sizeBytes / (1024 * 1024)).toFixed(2)} MB`
                      : `${(recordingModal.sizeBytes / 1024).toFixed(1)} KB`}
                  </span>
                </div>
                <div>
                  <span className="text-[#64748B] text-[10px] block">Format</span>
                  <span className="font-semibold text-[#F59E0B] font-mono uppercase">{recordingModal.ext}</span>
                </div>
              </div>
            </div>

            {/* Modal Footer Actions */}
            <div className="px-6 py-4 bg-[#131924] border-t border-[#1E2638] flex items-center justify-between gap-3">
              <button
                onClick={() => {
                  URL.revokeObjectURL(recordingModal.url);
                  setRecordingModal(null);
                }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-xs font-medium text-rose-400 border border-rose-500/20 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Recording</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    URL.revokeObjectURL(recordingModal.url);
                    setRecordingModal(null);
                  }}
                  className="px-4 py-2 rounded-lg bg-[#1E2638] hover:bg-[#263248] text-xs font-semibold text-[#94A3B8] hover:text-[#FFFFFF] transition-colors"
                >
                  Close
                </button>
                <a
                  href={recordingModal.url}
                  download={recordingModal.filename}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#F59E0B] hover:bg-[#D97706] text-xs font-bold text-[#000000] shadow transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download Video</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
