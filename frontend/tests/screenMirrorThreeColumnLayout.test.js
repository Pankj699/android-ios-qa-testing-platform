import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const screenMirrorPath = path.resolve(__dirname, '../src/components/ScreenMirrorView.jsx');
const appPath = path.resolve(__dirname, '../src/App.jsx');

describe('Screen Mirror Three-Column Layout Redesign Suite', () => {
  const componentCode = fs.readFileSync(screenMirrorPath, 'utf8');
  const appCode = fs.readFileSync(appPath, 'utf8');

  describe('1. Overall Three-Column Layout Structure', () => {
    it('implements flex-row root container with Left, Center, and Right panels', () => {
      assert.ok(componentCode.includes('flex flex-row text-[#FFFFFF] shadow-2xl'), 'Root container must be flex-row');
      assert.ok(componentCode.includes('aria-label="Screen Mirror Actions"'), 'Left actions panel must exist');
      assert.ok(componentCode.includes('aria-label="Screen Mirror Status & Controls"'), 'Right status panel must exist');
      assert.ok(componentCode.includes('ref={viewportRef}'), 'Center phone preview container must exist');
    });

    it('allocates approximately 104px width on desktop (md breakpoint) for side panels', () => {
      assert.ok(componentCode.includes('md:w-[104px]'), 'Side panels must have md:w-[104px]');
      assert.ok(componentCode.includes('shrink-0'), 'Side panels must have shrink-0 to prevent compression');
    });

    it('allocates flexible remaining space to the center phone preview', () => {
      assert.ok(componentCode.includes('flex-1 min-w-0 h-full bg-[#070A10]'), 'Center preview must be flex-1 and consume remaining space');
    });
  });

  describe('2. Left Panel – Actions', () => {
    it('contains resolution / quality selector with available presets', () => {
      assert.ok(componentCode.includes('qualityPreset'), 'Left panel must bind qualityPreset');
      assert.ok(componentCode.includes("value: '1080p', label: '1080p'"), 'Must offer 1080p');
      assert.ok(componentCode.includes("value: '720p', label: '720p'"), 'Must offer 720p');
      assert.ok(componentCode.includes("value: '480p', label: '480p'"), 'Must offer 480p');
    });

    it('contains screenshot capture button with camera icon', () => {
      assert.ok(componentCode.includes('handleTakeScreenshot'), 'Left panel must bind handleTakeScreenshot');
      assert.ok(componentCode.includes('Camera'), 'Must display camera icon');
    });

    it('contains screen recording controls (start, stop, rec duration, and download)', () => {
      assert.ok(componentCode.includes('handleStartRecordingUnified'), 'Must bind handleStartRecordingUnified');
      assert.ok(componentCode.includes('handleStopRecordingUnified'), 'Must bind handleStopRecordingUnified');
      assert.ok(componentCode.includes('formatDuration(recordingDurationSec)'), 'Must display duration when recording');
    });

    it('contains refresh / retry connection button', () => {
      assert.ok(componentCode.includes('handleRetry'), 'Must bind handleRetry');
      assert.ok(componentCode.includes('Restart Mirror Stream'), 'Must have refresh button tooltip');
    });

    it('contains power (stop mirror session) button', () => {
      assert.ok(componentCode.includes('handleExplicitStopMirror'), 'Must bind handleExplicitStopMirror');
    });

    it('contains expand / restore (fullscreen toggle) button', () => {
      assert.ok(componentCode.includes('toggleFullscreen'), 'Must bind toggleFullscreen');
      assert.ok(componentCode.includes('Minimize2'), 'Must have Minimize2 icon for restore');
      assert.ok(componentCode.includes('Maximize2'), 'Must have Maximize2 icon for expand');
    });

    it('contains close button when onClose prop is provided', () => {
      assert.ok(componentCode.includes('handleRequestClose'), 'Must bind handleRequestClose');
      assert.ok(componentCode.includes('Close Screen Mirror'), 'Must have close button tooltip');
    });
  });

  describe('3. Center Panel – Phone Preview', () => {
    it('displays compact top device header bar with thumbnail, device name, and LIVE badge', () => {
      assert.ok(componentCode.includes('DeviceThumbnail device={device}'), 'Must display device thumbnail');
      assert.ok(componentCode.includes('formatDeviceDisplayName(device)'), 'Must display formatted device display name');
      assert.ok(componentCode.includes('LIVE MIRROR'), 'Must display LIVE MIRROR indicator when active');
    });

    it('preserves phone frame notch / speaker', () => {
      assert.ok(componentCode.includes('bg-[#1E2638] rounded-full mb-1 shrink-0'), 'Must render phone top notch');
    });

    it('preserves virtual navigation softkeys (Recent Apps, Home, Back)', () => {
      assert.ok(componentCode.includes("keycode: 187"), 'Must send Recent Apps keycode 187');
      assert.ok(componentCode.includes("keycode: 3"), 'Must send Home keycode 3');
      assert.ok(componentCode.includes("keycode: 4"), 'Must send Back keycode 4');
    });

    it('preserves live video, browser USB img, and iOS iframe elements with object-contain', () => {
      assert.ok(componentCode.includes('ref={videoRef}'), 'Must bind videoRef');
      assert.ok(componentCode.includes('ref={imgRef}'), 'Must bind imgRef for WebUSB');
      assert.ok(componentCode.includes('iosStreamUrl'), 'Must handle iOS stream');
      assert.ok(componentCode.includes('object-contain'), 'Must use object-contain to prevent distortion');
    });

    it('preserves connection waiting and error overlays with retry handler', () => {
      assert.ok(componentCode.includes("mirrorStatus === 'connecting' || mirrorStatus === 'waiting_for_frame'"), 'Must render connecting overlay');
      assert.ok(componentCode.includes("mirrorStatus === 'error'"), 'Must render error overlay');
      assert.ok(componentCode.includes('Unable to Start Screen Mirror'), 'Must render error message');
    });

    it('dynamically computes fitted screen dimensions for seamless responsiveness', () => {
      assert.ok(componentCode.includes('calculateFittedScreenSize'), 'Must have dynamic scale calculation');
      assert.ok(componentCode.includes('aspectRatio = streamW / streamH'), 'Must preserve stream aspect ratio');
      assert.ok(componentCode.includes('ResizeObserver'), 'Must observe viewport resizing');
    });
  });

  describe('4. Right Panel – Status and Footer Controls', () => {
    it('displays stream status with live pulsing indicator', () => {
      assert.ok(componentCode.includes("mirrorStatus === 'live' ? 'bg-emerald-400 animate-pulse'"), 'Must display status dot');
    });

    it('displays FPS telemetry metric', () => {
      assert.ok(componentCode.includes('Activity'), 'Must display FPS icon');
      assert.ok(componentCode.includes("fps !== null ? fps : '--'"), 'Must display FPS value');
    });

    it('displays Latency telemetry metric', () => {
      assert.ok(componentCode.includes('Zap'), 'Must display Latency icon');
      assert.ok(componentCode.includes("latency !== null ? `${latency}ms` : '~24ms'"), 'Must display Latency value');
    });

    it('displays Stream Resolution telemetry metric', () => {
      assert.ok(componentCode.includes('Gauge'), 'Must display Resolution icon');
      assert.ok(componentCode.includes('{resolution}'), 'Must display resolution');
    });

    it('displays divider and Audio controls (Volume Up, Volume Down, Mute)', () => {
      assert.ok(componentCode.includes("keycode: 24"), 'Must send Volume Up keycode 24');
      assert.ok(componentCode.includes("keycode: 25"), 'Must send Volume Down keycode 25');
      assert.ok(componentCode.includes("keycode: 164"), 'Must send Mute keycode 164');
      assert.ok(componentCode.includes('VolumeX'), 'Must render mute icon VolumeX');
    });

    it('displays device hardware Power / Lock / Wake control', () => {
      assert.ok(componentCode.includes("keycode: 26"), 'Must send Power keycode 26');
    });
  });

  describe('5. Screen Mirror Dialog Modal Container in App.jsx', () => {
    it('configures dialog modal with max-w-5xl and h-[92vh] to give maximum space to phone preview', () => {
      assert.ok(appCode.includes('max-w-5xl h-[92vh] max-h-[92vh]'), 'Modal in App.jsx must use max-w-5xl and h-[92vh]');
    });
  });
});
