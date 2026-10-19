import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Scan,
  RefreshCw,
  Search,
  Copy,
  Check,
  ChevronRight,
  ChevronDown,
  Layers,
  Info,
  Maximize2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Smartphone,
  AlertTriangle,
  Code2,
  Sliders,
  Type,
  Layout,
  MousePointerClick,
  Sparkles,
  Pipette,
  CheckCircle2,
  XCircle,
  ArrowUp,
  FileText,
  SlidersHorizontal
} from 'lucide-react';
import { api } from '../services/api';
import { formatDeviceDisplayName, formatDeviceSelectorLabel } from '../utils/deviceFormatter';
import DeviceThumbnail from '../components/DeviceThumbnail';

/**
 * Normalize screenshot data to a valid image src.
 * The backend may return a raw base64 string OR a full data URI —
 * this helper prevents the double-prefix bug either way.
 */
function getScreenshotSrc(previewBase64) {
  if (!previewBase64) return '';
  if (previewBase64.startsWith('data:image/')) return previewBase64;
  return `data:image/png;base64,${previewBase64}`;
}

/**
 * Source badge pill component for labeling property fidelity.
 */

/**
 * Determine if a UI hierarchy node is a text-bearing element.
 * Uses Android class name and the presence of text content.
 */
const TEXT_CLASS_SUFFIXES = [
  'TextView', 'EditText', 'Button', 'CheckedTextView',
  'AutoCompleteTextView', 'MultiAutoCompleteTextView',
  'TextInputEditText', 'AppCompatTextView', 'AppCompatButton',
  'AppCompatEditText', 'MaterialButton', 'MaterialTextView',
  'TextInputLayout', 'Chip', 'ChipGroup', 'SwitchCompat',
  'TabItem', 'NavigationBarItemView'
];

function isTextNode(node) {
  if (!node || !node.text) return false;
  const shortClass = (node.className || '').split('.').pop();
  return TEXT_CLASS_SUFFIXES.some(suffix => shortClass.endsWith(suffix) || shortClass === suffix);
}

/**
 * Estimate the dominant text foreground color by analyzing pixels within
 * a text element's bounding box on the offscreen canvas.
 *
 * Algorithm:
 * 1. Sample a grid of pixels within the element's bounds.
 * 2. Compute the background color from edge/corner pixels (likely not text).
 * 3. Classify each sampled pixel as "foreground" if its luminance contrast
 *    against the background exceeds a threshold (text is always readable).
 * 4. If enough foreground pixels are found, compute the median RGB as the
 *    estimated text color.
 * 5. Returns null if foreground can't be reliably separated.
 *
 * @param {CanvasRenderingContext2D} ctx - offscreen canvas context
 * @param {{ left: number, top: number, width: number, height: number }} bounds
 * @param {number} canvasW - full canvas width
 * @param {number} canvasH - full canvas height
 * @returns {{ hex: string, rgb: string, r: number, g: number, b: number, confidence: string } | null}
 */
function estimateTextForegroundColor(ctx, bounds, canvasW, canvasH) {
  const { left, top, width, height } = bounds;
  if (width < 4 || height < 4) return null;

  // Clamp to canvas
  const x0 = Math.max(0, Math.min(canvasW - 1, left));
  const y0 = Math.max(0, Math.min(canvasH - 1, top));
  const x1 = Math.max(0, Math.min(canvasW - 1, left + width - 1));
  const y1 = Math.max(0, Math.min(canvasH - 1, top + height - 1));
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  if (w < 4 || h < 4) return null;

  // Helper: relative luminance (0–255 scale for speed)
  const luminance = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

  // Sample edge pixels (2px border ring) to estimate background color
  let edgeData;
  try {
    edgeData = ctx.getImageData(x0, y0, w, h).data;
  } catch {
    return null;
  }

  const edgePixels = [];
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      // Only edge: first/last 2 rows or first/last 2 cols
      const isEdge = py < 2 || py >= h - 2 || px < 2 || px >= w - 2;
      if (isEdge) {
        const idx = (py * w + px) * 4;
        edgePixels.push({ r: edgeData[idx], g: edgeData[idx + 1], b: edgeData[idx + 2] });
      }
    }
  }

  if (edgePixels.length === 0) return null;

  // Median of edge pixels as background estimate
  const sortedEdge = [...edgePixels].sort((a, b) => luminance(a.r, a.g, a.b) - luminance(b.r, b.g, b.b));
  const bgColor = sortedEdge[Math.floor(sortedEdge.length / 2)];
  const bgLum = luminance(bgColor.r, bgColor.g, bgColor.b);

  // Sample a grid of interior pixels (skip edge ring)
  const stepX = Math.max(1, Math.floor(w / 20));
  const stepY = Math.max(1, Math.floor(h / 12));
  const fgPixels = [];
  const contrastThreshold = 30; // minimum luminance contrast to consider as glyph

  for (let py = 2; py < h - 2; py += stepY) {
    for (let px = 2; px < w - 2; px += stepX) {
      const idx = (py * w + px) * 4;
      const r = edgeData[idx], g = edgeData[idx + 1], b = edgeData[idx + 2];
      const pxLum = luminance(r, g, b);
      const contrast = Math.abs(pxLum - bgLum);
      if (contrast >= contrastThreshold) {
        fgPixels.push({ r, g, b, lum: pxLum });
      }
    }
  }

  // Need at least 3 foreground pixels for a meaningful estimate
  if (fgPixels.length < 3) return null;

  // Determine confidence based on foreground pixel count
  const totalSampled = Math.ceil((w - 4) / stepX) * Math.ceil((h - 4) / stepY);
  const fgRatio = fgPixels.length / Math.max(1, totalSampled);
  let confidence;
  if (fgRatio > 0.6) confidence = 'high — dense text coverage';
  else if (fgRatio > 0.15) confidence = 'medium — partial text coverage';
  else confidence = 'low — sparse text pixels';

  // Median RGB of foreground pixels (robust to anti-aliasing outliers)
  const sortR = [...fgPixels].sort((a, b) => a.r - b.r);
  const sortG = [...fgPixels].sort((a, b) => a.g - b.g);
  const sortB = [...fgPixels].sort((a, b) => a.b - b.b);
  const mid = Math.floor(fgPixels.length / 2);
  const estR = sortR[mid].r;
  const estG = sortG[mid].g;
  const estB = sortB[mid].b;

  const hex = '#' + ((1 << 24) + (estR << 16) + (estG << 8) + estB).toString(16).slice(1).toUpperCase();
  const rgb = `rgb(${estR}, ${estG}, ${estB})`;

  return { hex, rgb, r: estR, g: estG, b: estB, confidence };
}
function SourceBadge({ source = 'Native' }) {
  const styles = {
    Native: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    EXACT: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    Runtime: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    Inferred: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    INFERRED: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    Estimated: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    ESTIMATED: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    Unavailable: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
    UNAVAILABLE: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
    Instrumented: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
    'Pixel sample': 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30'
  };

  const badgeStyle = styles[source] || styles.Native;

  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold uppercase tracking-wider border ${badgeStyle} shrink-0`}
      title={`Source fidelity: ${source}`}
    >
      {source}
    </span>
  );
}

/**
 * Property row with copy button and explicit source badge.
 */
function PropertyRow({ label, value, source = 'Native', onCopy, canCopy = true, monospace = true, note }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!value || value === '—') return;
    navigator.clipboard.writeText(value);
    setCopied(true);
    if (onCopy) onCopy(label, value);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="flex items-start justify-between py-2 border-b border-[#1A202C]/60 last:border-b-0 hover:bg-[#131722]/50 px-2 rounded-lg transition-colors group">
      <div className="flex flex-col min-w-0 pr-2">
        <span className="text-[11px] font-semibold text-[#8B949E] tracking-tight">{label}</span>
        <span
          className={`text-xs text-[#E6EDF3] break-all select-all ${monospace ? 'font-mono' : 'font-sans'}`}
        >
          {value || '—'}
        </span>
        {note && <span className="text-[10px] text-[#64748B] italic mt-0.5">{note}</span>}
      </div>
      <div className="flex items-center gap-2 shrink-0 pt-0.5">
        <SourceBadge source={source} />
        {canCopy && value && value !== '—' && (
          <button
            onClick={handleCopy}
            className="p-1 rounded text-[#717E91] hover:text-white hover:bg-[#1E2538] transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
            title={`Copy ${label}`}
            aria-label={`Copy ${label}`}
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Tree node item for the hierarchy tree view.
 */
function HierarchyTreeNode({
  node,
  selectedNode,
  hoveredNode,
  onSelectNode,
  onHoverNode,
  searchQuery,
  expandedIds,
  onToggleExpand
}) {
  const isSelected = selectedNode?.id === node.id;
  const isHovered = hoveredNode?.id === node.id;
  const hasChildren = node.children && node.children.length > 0;
  const isExpanded = expandedIds.has(node.id);

  // Shorten class name for cleaner display (e.g., android.widget.TextView -> TextView)
  const shortClass = node.className.split('.').pop() || node.className;
  const labelText = node.text ? `"${node.text.slice(0, 24)}${node.text.length > 24 ? '…' : ''}"` : '';
  const shortResId = node.resourceId ? node.resourceId.split(':id/').pop() : '';

  // Match search query
  const matchesSearch = searchQuery && (
    node.className.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (node.resourceId && node.resourceId.toLowerCase().includes(searchQuery.toLowerCase())) ||
    (node.text && node.text.toLowerCase().includes(searchQuery.toLowerCase())) ||
    (node.contentDesc && node.contentDesc.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="text-xs select-none">
      <div
        className={`flex items-center gap-1.5 py-1 px-2 rounded-lg cursor-pointer transition-all ${
          isSelected
            ? 'bg-[#F59E0B]/20 text-[#F59E0B] font-semibold border border-[#F59E0B]/40'
            : isHovered
            ? 'bg-[#1E2538] text-white'
            : matchesSearch
            ? 'bg-[#1F293D] text-amber-300 border border-amber-500/30'
            : 'text-[#94A3B8] hover:bg-[#131722] hover:text-[#E2E8F0]'
        }`}
        style={{ paddingLeft: `${node.depth * 14 + 8}px` }}
        onClick={() => onSelectNode(node)}
        onMouseEnter={() => onHoverNode(node)}
        onMouseLeave={() => onHoverNode(null)}
      >
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(node.id);
            }}
            className="p-0.5 hover:text-white rounded text-[#64748B]"
          >
            {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>
        ) : (
          <span className="w-3 h-3 inline-block" />
        )}

        <span className="font-mono text-[11px] text-[#A5B4FC] shrink-0">{shortClass}</span>

        {shortResId && (
          <span className="text-[10px] font-mono text-[#F59E0B] truncate max-w-[120px]" title={node.resourceId}>
            #{shortResId}
          </span>
        )}

        {labelText && (
          <span className="text-[10px] text-[#94A3B8] italic truncate max-w-[120px]">
            {labelText}
          </span>
        )}

        {node.states?.clickable && (
          <span className="ml-auto text-[9px] px-1 py-0.2 rounded bg-sky-500/10 text-sky-400 font-mono">
            tap
          </span>
        )}
      </div>

      {hasChildren && isExpanded && (
        <div>
          {node.children.map((child) => (
            <HierarchyTreeNode
              key={child.id}
              node={child}
              selectedNode={selectedNode}
              hoveredNode={hoveredNode}
              onSelectNode={onSelectNode}
              onHoverNode={onHoverNode}
              searchQuery={searchQuery}
              expandedIds={expandedIds}
              onToggleExpand={onToggleExpand}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function UiInspectorPage({
  devices = [],
  selectedDevice,
  onSelectDevice,
  onOpenPairModal
}) {
  const currentDevice = selectedDevice || devices[0] || null;
  const isIos = currentDevice?.platform === 'ios';
  const currentSerial = currentDevice?.serial || currentDevice?.id;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [inspectionData, setInspectionData] = useState(() => {
    try {
      if (currentSerial) {
        const cached = sessionStorage.getItem(`ui_inspector_last_${currentSerial}`);
        if (cached) return JSON.parse(cached);
      }
    } catch {}
    return null;
  });
  const [selectedNode, setSelectedNode] = useState(() => {
    try {
      if (currentSerial) {
        const cached = sessionStorage.getItem(`ui_inspector_last_${currentSerial}`);
        if (cached) {
          const parsed = JSON.parse(cached);
          return parsed.hierarchy?.rootNode || null;
        }
      }
    } catch {}
    return null;
  });
  const [hoveredNode, setHoveredNode] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [zoomLevel, setZoomLevel] = useState(1);
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [toastMessage, setToastMessage] = useState(null);

  // Overlapping elements at clicked point
  const [elementsAtPoint, setElementsAtPoint] = useState([]);

  // Color Sampling & Eyedropper state
  const [eyedropperActive, setEyedropperActive] = useState(false);
  const [sampledColor, setSampledColor] = useState(null);
  const [runtimeInspecting, setRuntimeInspecting] = useState(false);

  // Inspector Mode Tabs: 'properties' | 'figma-qa'
  const [activeInspectorTab, setActiveInspectorTab] = useState('properties');

  // Manual Figma Spec QA comparison inputs
  const [expectedSpecs, setExpectedSpecs] = useState({
    width: '',
    height: '',
    fontSize: '',
    colorHex: ''
  });

  const imageRef = useRef(null);
  const containerRef = useRef(null);
  const offscreenCanvasRef = useRef(null);
  const inspectSeqRef = useRef(0);

  // When switching device, restore cached inspection for that device if present
  useEffect(() => {
    if (!currentSerial) {
      setInspectionData(null);
      setSelectedNode(null);
      return;
    }
    if (inspectionData && inspectionData.device?.serial !== currentSerial) {
      try {
        const cached = sessionStorage.getItem(`ui_inspector_last_${currentSerial}`);
        if (cached) {
          const parsed = JSON.parse(cached);
          setInspectionData(parsed);
          setSelectedNode(parsed.hierarchy?.rootNode || null);
          return;
        }
      } catch {}
      setInspectionData(null);
      setSelectedNode(null);
    }
  }, [currentSerial]);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2200);
  };

  // Build offscreen canvas when screenshot base64 changes
  useEffect(() => {
    if (!inspectionData?.screenshot?.previewBase64) {
      offscreenCanvasRef.current = null;
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        offscreenCanvasRef.current = { canvas, ctx, width: img.naturalWidth, height: img.naturalHeight };
      }
    };
    img.src = getScreenshotSrc(inspectionData.screenshot.previewBase64);
  }, [inspectionData]);

  // Sample color at device coordinates (x, y)
  const sampleColorAt = useCallback((x, y) => {
    if (!offscreenCanvasRef.current) return null;
    const { ctx, width, height } = offscreenCanvasRef.current;
    const clampedX = Math.max(0, Math.min(width - 1, Math.round(x)));
    const clampedY = Math.max(0, Math.min(height - 1, Math.round(y)));

    try {
      const pixel = ctx.getImageData(clampedX, clampedY, 1, 1).data;
      const hex = '#' + ((1 << 24) + (pixel[0] << 16) + (pixel[1] << 8) + pixel[2]).toString(16).slice(1).toUpperCase();
      const rgb = `rgb(${pixel[0]}, ${pixel[1]}, ${pixel[2]})`;
      return { hex, rgb, r: pixel[0], g: pixel[1], b: pixel[2], a: pixel[3] };
    } catch {
      return null;
    }
  }, []);

  // When selectedNode changes, automatically sample color
  // For text nodes: estimate foreground text color from multi-pixel analysis
  // For non-text nodes: sample center pixel (labeled as pixel sample, not text color)
  useEffect(() => {
    if (!selectedNode || !offscreenCanvasRef.current) return;
    const b = selectedNode.bounds;
    if (!b || b.width <= 0 || b.height <= 0) return;

    const { ctx, width: canvasW, height: canvasH } = offscreenCanvasRef.current;

    if (isTextNode(selectedNode)) {
      // Multi-pixel foreground color estimation for text elements
      const estimated = estimateTextForegroundColor(ctx, b, canvasW, canvasH);
      if (estimated) {
        setSampledColor({
          hex: estimated.hex,
          rgb: estimated.rgb,
          r: estimated.r,
          g: estimated.g,
          b: estimated.b,
          source: 'Estimated',
          sourceNote: `Estimated text color (${estimated.confidence})`,
          isTextEstimate: true
        });
      } else {
        // Could not reliably separate foreground — report limitation
        setSampledColor({
          hex: null,
          rgb: null,
          source: 'Unavailable',
          sourceNote: 'Could not reliably separate text pixels from background',
          isTextEstimate: true
        });
      }
    } else {
      // Non-text element: sample center pixel
      const centerX = b.left + b.width / 2;
      const centerY = b.top + b.height / 2;
      const col = sampleColorAt(centerX, centerY);
      if (col) {
        setSampledColor({
          ...col,
          source: 'Pixel sample',
          sourceNote: 'Center pixel — may not represent the element\'s actual color',
          isTextEstimate: false
        });
      }
    }
  }, [selectedNode, sampleColorAt]);

  // Helper to expand all ancestors of a node
  const expandAncestors = useCallback((node, root) => {
    if (!node || !root) return;
    const pathIds = new Set();
    const findPath = (curr) => {
      if (curr.id === node.id) return true;
      if (curr.children) {
        for (const child of curr.children) {
          if (findPath(child)) {
            pathIds.add(curr.id);
            return true;
          }
        }
      }
      return false;
    };
    findPath(root);
    setExpandedIds((prev) => new Set([...prev, ...pathIds]));
  }, []);

  // Fetch UI hierarchy and screenshot
  const handleInspect = async () => {
    if (!currentDevice) return;
    if (isIos) {
      setError('UI Inspector currently supports Android devices. iOS native inspection requires companion XCUITest agent.');
      return;
    }

    const deviceSerial = currentDevice.serial || currentDevice.id;
    if (!deviceSerial) {
      setError('Selected device has no valid serial.');
      return;
    }

    setLoading(true);
    setError(null);

    const prevSelectedPath = selectedNode?.hierarchyPath;
    const prevResId = selectedNode?.resourceId;
    const seq = ++inspectSeqRef.current;

    try {
      const res = await api.getUiHierarchy(deviceSerial);
      if (seq !== inspectSeqRef.current) {
        // Discard stale out-of-order response
        return;
      }

      if (res.success && res.hierarchy) {
        setInspectionData(res);
        try {
          sessionStorage.setItem(`ui_inspector_last_${deviceSerial}`, JSON.stringify(res));
        } catch {}

        // Try to re-select node with same resourceId or hierarchyPath across refresh
        let nodeToSelect = null;
        if (prevResId || prevSelectedPath) {
          const findMatching = (n) => {
            if (prevResId && n.resourceId === prevResId) return n;
            if (prevSelectedPath && n.hierarchyPath === prevSelectedPath) return n;
            if (n.children) {
              for (const child of n.children) {
                const found = findMatching(child);
                if (found) return found;
              }
            }
            return null;
          };
          nodeToSelect = findMatching(res.hierarchy.rootNode);
        }

        if (!nodeToSelect) {
          nodeToSelect = res.hierarchy.rootNode;
        }

        setSelectedNode(nodeToSelect);
        setHoveredNode(null);
        setElementsAtPoint(nodeToSelect ? [nodeToSelect] : []);

        const defaultExpanded = new Set([res.hierarchy.rootNode?.id]);
        if (res.hierarchy.rootNode?.children) {
          res.hierarchy.rootNode.children.forEach((c) => defaultExpanded.add(c.id));
        }
        setExpandedIds(defaultExpanded);

        if (nodeToSelect) {
          expandAncestors(nodeToSelect, res.hierarchy.rootNode);
        }

        showToast('UI hierarchy & screen captured successfully');
      } else {
        throw new Error(res.error || 'Failed to inspect UI hierarchy');
      }
    } catch (err) {
      if (seq === inspectSeqRef.current) {
        setError(err.message || 'Inspection failed');
        // Do NOT reset inspectionData or selectedNode: keep existing viewport and tree visible
      }
    } finally {
      if (seq === inspectSeqRef.current) {
        setLoading(false);
      }
    }
  };

  // User-triggered runtime JDWP inspection for selected text element
  const handleInspectRuntimeTypography = async () => {
    if (!currentDevice || !selectedNode) return;
    const deviceSerial = currentDevice.serial || currentDevice.id;
    if (!deviceSerial) {
      showToast('No active device selected');
      return;
    }

    const packageName = selectedNode.package || inspectionData?.hierarchy?.rootNode?.package;
    if (!packageName) {
      showToast('No package name detected for this element');
      return;
    }

    setRuntimeInspecting(true);
    try {
      const res = await api.getRuntimeTypography(deviceSerial, {
        packageName,
        node: {
          text: selectedNode.text,
          resourceId: selectedNode.resourceId,
          className: selectedNode.className,
          bounds: selectedNode.bounds
        }
      });

      if (res.success && res.typography) {
        setSelectedNode((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            typography: {
              ...prev.typography,
              ...res.typography
            },
            propertySources: {
              ...prev.propertySources,
              fontSize: res.typography.fontSize?.status || res.typography.fontSize?.source || prev.propertySources?.fontSize || 'Estimated',
              fontWeight: res.typography.fontWeight?.status || res.typography.fontWeight?.source || 'Runtime',
              fontStyle: res.typography.fontStyle?.status || res.typography.fontStyle?.source || 'Runtime',
              fontFamily: res.typography.fontFamily?.status || res.typography.fontFamily?.source || 'Inferred'
            }
          };
        });

        if (res.runtimeView?.textColor) {
          const rawHex = res.runtimeView.textColor;
          let hex = rawHex;
          if (rawHex.length === 9) {
            hex = '#' + rawHex.slice(3);
          }
          const num = parseInt(hex.replace('#', ''), 16);
          const r = !isNaN(num) ? ((num >> 16) & 255) : 255;
          const g = !isNaN(num) ? ((num >> 8) & 255) : 255;
          const b = !isNaN(num) ? (num & 255) : 255;

          setSampledColor({
            hex,
            rgb: `rgb(${r}, ${g}, ${b})`,
            r,
            g,
            b,
            source: 'Native',
            sourceNote: `Exact TextView.mCurTextColor via JDWP (${rawHex})`,
            isTextEstimate: false
          });
        }

        showToast(`Runtime typography retrieved (PID ${res.typography.runtime?.pid || ''})`);
      } else {
        showToast(res.error || 'Could not retrieve runtime typography');
      }
    } catch (err) {
      if (err.status === 404) {
        showToast('Runtime inspection endpoint not found (404). Ensure the backend service has been restarted with the latest routes.');
      } else if (err.status === 401 || err.status === 403) {
        showToast('Device is not accessible. Please claim the device before inspecting runtime typography.');
      } else {
        const errorMsg = err.data?.error || err.data?.message || err.message || 'Error extracting runtime typography';
        showToast(errorMsg);
      }
    } finally {
      setRuntimeInspecting(false);
    }
  };

  // Build flat list of nodes
  const flatNodes = useMemo(() => {
    if (!inspectionData?.hierarchy?.rootNode) return [];
    const list = [];
    const traverse = (node, parentList = []) => {
      node._ancestors = parentList;
      node._parent = parentList.length > 0 ? parentList[parentList.length - 1] : null;
      list.push(node);
      if (node.children) {
        for (const child of node.children) {
          traverse(child, [...parentList, node]);
        }
      }
    };
    traverse(inspectionData.hierarchy.rootNode, []);
    return list;
  }, [inspectionData]);

  // Search matches counter and auto-expansion
  const searchMatches = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const query = searchQuery.toLowerCase();
    return flatNodes.filter(
      (n) =>
        n.className.toLowerCase().includes(query) ||
        (n.resourceId && n.resourceId.toLowerCase().includes(query)) ||
        (n.text && n.text.toLowerCase().includes(query)) ||
        (n.contentDesc && n.contentDesc.toLowerCase().includes(query))
    );
  }, [flatNodes, searchQuery]);

  // Auto-expand matching ancestors when searching
  useEffect(() => {
    if (searchMatches.length > 0 && searchQuery.trim().length > 1) {
      const matchAncestors = new Set();
      searchMatches.forEach((node) => {
        if (node._ancestors) {
          node._ancestors.forEach((anc) => matchAncestors.add(anc.id));
        }
      });
      setExpandedIds((prev) => new Set([...prev, ...matchAncestors]));
    }
  }, [searchMatches, searchQuery]);

  // Click on viewport image to select element or sample pixel color
  const handleViewportClick = (e) => {
    if (!imageRef.current || !inspectionData) return;

    const rect = imageRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const naturalWidth = imageRef.current.naturalWidth;
    const naturalHeight = imageRef.current.naturalHeight;

    if (!naturalWidth || !naturalHeight) return;

    // Convert display click to native device coordinates
    const scaleX = naturalWidth / rect.width;
    const scaleY = naturalHeight / rect.height;

    const deviceX = Math.round(clickX * scaleX);
    const deviceY = Math.round(clickY * scaleY);

    // If Eyedropper mode is active, sample color only
    if (eyedropperActive) {
      const col = sampleColorAt(deviceX, deviceY);
      if (col) {
        setSampledColor({
          ...col,
          source: 'Pixel sample',
          sourceNote: `Exact pixel at (${deviceX}, ${deviceY})`,
          isTextEstimate: false
        });
        showToast(`Sampled color ${col.hex}`);
      }
      return;
    }

    // Find all nodes covering this point
    const matchingNodes = flatNodes.filter((node) => {
      const b = node.bounds;
      return (
        deviceX >= b.left &&
        deviceX <= b.right &&
        deviceY >= b.top &&
        deviceY <= b.bottom &&
        b.width > 0 &&
        b.height > 0
      );
    });

    if (matchingNodes.length > 0) {
      // Sort deepest leaf first (smallest area, greatest depth)
      matchingNodes.sort((a, b) => {
        const areaA = a.bounds.width * a.bounds.height;
        const areaB = b.bounds.width * b.bounds.height;
        if (areaA !== areaB) return areaA - areaB;
        return b.depth - a.depth;
      });

      setElementsAtPoint(matchingNodes);
      const selected = matchingNodes[0];
      setSelectedNode(selected);
      expandAncestors(selected, inspectionData.hierarchy.rootNode);

      // Also sample color at exact click point
      const col = sampleColorAt(deviceX, deviceY);
      if (col) {
        setSampledColor({ ...col, sourceNote: `Sampled at click point (${deviceX}, ${deviceY})` });
      }
    } else {
      setElementsAtPoint([]);
    }
  };

  // Hover on viewport image
  const handleViewportMouseMove = (e) => {
    if (!imageRef.current || !inspectionData || eyedropperActive) return;

    const rect = imageRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const naturalWidth = imageRef.current.naturalWidth;
    const naturalHeight = imageRef.current.naturalHeight;

    if (!naturalWidth || !naturalHeight) return;

    const scaleX = naturalWidth / rect.width;
    const scaleY = naturalHeight / rect.height;

    const deviceX = Math.round(clickX * scaleX);
    const deviceY = Math.round(clickY * scaleY);

    const matchingNodes = flatNodes.filter((node) => {
      const b = node.bounds;
      return (
        deviceX >= b.left &&
        deviceX <= b.right &&
        deviceY >= b.top &&
        deviceY <= b.bottom &&
        b.width > 0 &&
        b.height > 0
      );
    });

    if (matchingNodes.length > 0) {
      matchingNodes.sort((a, b) => {
        const areaA = a.bounds.width * a.bounds.height;
        const areaB = b.bounds.width * b.bounds.height;
        if (areaA !== areaB) return areaA - areaB;
        return b.depth - a.depth;
      });
      setHoveredNode(matchingNodes[0]);
    } else {
      setHoveredNode(null);
    }
  };

  const handleToggleExpand = (id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Convert device bounds to percentage for overlay boxes
  const getBoundsPercentage = (bounds) => {
    if (!bounds || !imageRef.current) return null;
    const nw = imageRef.current.naturalWidth;
    const nh = imageRef.current.naturalHeight;
    if (!nw || !nh) return null;

    return {
      left: `${(bounds.left / nw) * 100}%`,
      top: `${(bounds.top / nh) * 100}%`,
      width: `${(bounds.width / nw) * 100}%`,
      height: `${(bounds.height / nh) * 100}%`
    };
  };

  const selectedOverlayStyle = selectedNode ? getBoundsPercentage(selectedNode.bounds) : null;
  const hoveredOverlayStyle = hoveredNode && hoveredNode.id !== selectedNode?.id ? getBoundsPercentage(hoveredNode.bounds) : null;

  // Breadcrumbs for selected node
  const breadcrumbTrail = useMemo(() => {
    if (!selectedNode) return [];
    return [...(selectedNode._ancestors || []), selectedNode];
  }, [selectedNode]);

  // Navigate to parent node
  const handleSelectParent = () => {
    if (selectedNode?._parent) {
      setSelectedNode(selectedNode._parent);
      expandAncestors(selectedNode._parent, inspectionData.hierarchy.rootNode);
    }
  };

  // Figma Spec QA Comparison Results
  const figmaComparison = useMemo(() => {
    if (!selectedNode) return null;

    const results = [];
    const b = selectedNode.bounds;

    // 1. Width Comparison
    if (expectedSpecs.width.trim()) {
      const expW = parseFloat(expectedSpecs.width);
      if (!isNaN(expW)) {
        const diff = b.width - expW;
        const match = Math.abs(diff) <= 2;
        results.push({
          prop: 'Width',
          expected: `${expW}px`,
          actual: `${b.width}px`,
          delta: diff === 0 ? '0px' : `${diff > 0 ? '+' : ''}${diff}px`,
          status: match ? 'MATCH' : 'MISMATCH',
          source: 'Native'
        });
      }
    }

    // 2. Height Comparison
    if (expectedSpecs.height.trim()) {
      const expH = parseFloat(expectedSpecs.height);
      if (!isNaN(expH)) {
        const diff = b.height - expH;
        const match = Math.abs(diff) <= 2;
        results.push({
          prop: 'Height',
          expected: `${expH}px`,
          actual: `${b.height}px`,
          delta: diff === 0 ? '0px' : `${diff > 0 ? '+' : ''}${diff}px`,
          status: match ? 'MATCH' : 'MISMATCH',
          source: 'Native'
        });
      }
    }

    // 3. Font Size Comparison
    if (expectedSpecs.fontSize.trim()) {
      const expFont = parseFloat(expectedSpecs.fontSize);
      const estFontStr = selectedNode.typography?.fontSize?.value || '';
      const matchSp = estFontStr.match(/~(\d+)sp/);
      const estSp = matchSp ? parseFloat(matchSp[1]) : null;

      if (!isNaN(expFont)) {
        if (estSp !== null) {
          const diff = estSp - expFont;
          const match = Math.abs(diff) <= 1;
          results.push({
            prop: 'Font Size',
            expected: `${expFont}sp`,
            actual: estFontStr,
            delta: diff === 0 ? '0sp' : `${diff > 0 ? '+' : ''}${diff}sp`,
            status: match ? 'MATCH' : 'MISMATCH',
            source: 'Estimated',
            note: 'Visual heuristic comparison'
          });
        } else {
          results.push({
            prop: 'Font Size',
            expected: `${expFont}sp`,
            actual: 'No text present',
            delta: '—',
            status: 'UNAVAILABLE',
            source: 'Unavailable'
          });
        }
      }
    }

    // 4. Color Comparison (HEX)
    if (expectedSpecs.colorHex.trim()) {
      const expHex = expectedSpecs.colorHex.trim().toUpperCase();
      const actualHex = sampledColor?.hex || null;
      const isSampled = !!actualHex;
      const match = actualHex === expHex;
      const isEstimated = sampledColor?.source === 'Estimated' || sampledColor?.source === 'Pixel sample';

      let status = 'UNAVAILABLE';
      let delta = '—';
      let note = 'No color sampled';

      if (!isSampled) {
        status = 'UNAVAILABLE';
        note = sampledColor?.sourceNote || 'No color sampled';
      } else if (match) {
        // If match comes from an estimated source, do not mark as exact MATCH
        status = isEstimated ? 'ESTIMATED CHECK' : 'MATCH';
        delta = 'Matches (est)';
        note = sampledColor?.sourceNote || 'Estimated visual match; verify on-device paint if exactness required';
      } else {
        status = 'MISMATCH';
        delta = 'Hex Diff';
        note = sampledColor?.sourceNote || 'Visual color mismatch against expected';
      }

      results.push({
        prop: 'Color (HEX)',
        expected: expHex,
        actual: actualHex || 'Not Sampled',
        delta,
        status,
        source: sampledColor?.source || 'Estimated',
        note
      });
    }

    // 5. Typography Metadata (Font Family & Weight Provenance)
    if (selectedNode.text && selectedNode.text.trim()) {
      const ff = selectedNode.typography?.fontFamily;
      if (ff && ff.value && ff.value !== 'Not exposed by UIAutomator') {
        results.push({
          prop: 'Font Family',
          expected: 'From APK/Runtime',
          actual: ff.value,
          delta: '—',
          status: ff.status || (ff.source === 'Inferred' ? 'INFERRED' : 'ESTIMATED CHECK'),
          source: ff.source || 'Inferred',
          note: ff.note || 'Cataloged from application package assets'
        });
      }

      const fw = selectedNode.typography?.fontWeight;
      if (fw && fw.value && fw.value !== 'Not exposed by UIAutomator') {
        results.push({
          prop: 'Font Weight',
          expected: 'From APK/Runtime',
          actual: fw.value,
          delta: '—',
          status: fw.status || (fw.source === 'Inferred' ? 'INFERRED' : 'ESTIMATED CHECK'),
          source: fw.source || 'Inferred',
          note: fw.note || 'Cataloged from application package assets'
        });
      }
    }

    return results;
  }, [selectedNode, expectedSpecs, sampledColor]);

  // Copy QA Bug Report markdown
  const handleCopyQaReport = () => {
    if (!selectedNode || !figmaComparison || figmaComparison.length === 0) {
      showToast('Enter expected specs to generate QA report');
      return;
    }

    const shortClass = selectedNode.className.split('.').pop();
    let report = `### UI QA Spec Verification: <${shortClass}>\n`;
    report += `- **Resource ID**: \`${selectedNode.resourceId || 'N/A'}\`\n`;
    report += `- **XPath**: \`${selectedNode.xpath}\`\n`;
    report += `- **Bounds**: \`${selectedNode.bounds?.raw}\`\n\n`;
    report += `| Property | Expected (Figma) | Actual (Device) | Delta | Result | Source / Note |\n`;
    report += `| :--- | :--- | :--- | :--- | :--- | :--- |\n`;

    figmaComparison.forEach((row) => {
      const noteStr = row.note ? ` - ${row.note}` : '';
      report += `| **${row.prop}** | \`${row.expected}\` | \`${row.actual}\` | ${row.delta} | **${row.status}** | ${row.source}${noteStr} |\n`;
    });

    navigator.clipboard.writeText(report);
    showToast('QA Spec Report copied to clipboard');
  };

  return (
    <div className="space-y-6 animate-fadeIn pb-12">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded-xl bg-[#1F293D] border border-amber-500/50 text-white text-xs font-semibold shadow-2xl flex items-center gap-2 animate-slideUp">
          <Sparkles className="w-4 h-4 text-amber-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Header Card */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-[#10131B] border border-[#1C2230] p-5 rounded-2xl shadow-sm">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-[#16130C] border border-[#F59E0B]/40 flex items-center justify-center text-[#F59E0B] shadow-inner">
            <Scan className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-[#FFFFFF] flex items-center gap-2">
              Android UI Inspector
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-amber-500/10 text-amber-400 border border-amber-500/20 font-semibold">
                UIAutomator + Design QA
              </span>
            </h2>
            <p className="text-xs text-[#94A3B8]">
              Click-to-inspect native Android hierarchy, bounds, XPath, states, color eyedropper and Figma spec comparison
            </p>
          </div>
        </div>

        {/* Action Controls & Device Picker */}
        <div className="flex flex-wrap items-center gap-3">
          {devices.length > 0 && (
            <div className="flex items-center gap-2">
              <DeviceThumbnail device={currentDevice} size="xs" />
              <select
                value={currentDevice?.serial || ''}
                onChange={(e) => {
                  const target = devices.find((d) => d.serial === e.target.value);
                  if (target && onSelectDevice) onSelectDevice(target);
                }}
                className="px-3 py-2 bg-[#080B10] border border-[#1C2230] rounded-xl text-xs font-semibold text-[#FFFFFF] focus:outline-none focus:border-[#F59E0B] cursor-pointer"
              >
                {devices.map((d) => (
                  <option key={d.serial} value={d.serial} className="bg-[#10131B]">
                    {formatDeviceSelectorLabel(d)}
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            onClick={handleInspect}
            disabled={loading || !currentDevice || isIos}
            className={`px-4 py-2 rounded-xl text-xs font-bold shadow-md transition-all flex items-center gap-2 ${
              loading || !currentDevice || isIos
                ? 'bg-[#1C2230] text-[#64748B] cursor-not-allowed border border-[#273142]'
                : 'bg-[#F59E0B] hover:bg-[#D97706] text-black border border-amber-400/30'
            }`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>{loading ? 'Dumping Hierarchy...' : inspectionData ? 'Refresh Inspection' : 'Inspect Device'}</span>
          </button>
        </div>
      </div>

      {/* iOS Warning Notice */}
      {isIos && (
        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
          <div>
            <span className="font-bold">iOS Inspection Notice:</span> The live UIAutomator Inspector is Android-native. iOS device inspection requires companion XCUITest accessibility agent. Please select an Android device.
          </div>
        </div>
      )}

      {/* Error Banner */}
      {error && !isIos && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-200 text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            onClick={handleInspect}
            className="px-2.5 py-1 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-white font-semibold text-[11px]"
          >
            Retry
          </button>
        </div>
      )}

      {/* Main 3-Column Layout: Viewport | Hierarchy Tree | Properties & Design QA Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Viewport (5 cols) */}
        <div className="lg:col-span-5 flex flex-col space-y-3 bg-[#10131B] border border-[#1C2230] p-4 rounded-2xl shadow-sm">
          <div className="flex items-center justify-between pb-2 border-b border-[#1C2230]">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-white flex items-center gap-1.5">
                <MousePointerClick className="w-4 h-4 text-amber-400" />
                Viewport
              </span>

              {/* Eyedropper Toggle Button */}
              {inspectionData?.screenshot?.previewBase64 && (
                <button
                  onClick={() => setEyedropperActive(!eyedropperActive)}
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold flex items-center gap-1 transition-all ${
                    eyedropperActive
                      ? 'bg-amber-500 text-black shadow'
                      : 'bg-[#1C2230] text-[#94A3B8] hover:text-white hover:bg-[#252E40]'
                  }`}
                  title="Toggle Eyedropper to sample pixel color"
                >
                  <Pipette className="w-3 h-3" />
                  <span>{eyedropperActive ? 'Eyedropper Active' : 'Eyedropper'}</span>
                </button>
              )}
            </div>

            {/* Zoom Controls */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => setZoomLevel((z) => Math.max(0.6, z - 0.2))}
                className="p-1 rounded text-[#717E91] hover:text-white hover:bg-[#1E2538]"
                title="Zoom Out"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="text-[10px] font-mono text-[#8B949E] px-1">{Math.round(zoomLevel * 100)}%</span>
              <button
                onClick={() => setZoomLevel((z) => Math.min(2.0, z + 0.2))}
                className="p-1 rounded text-[#717E91] hover:text-white hover:bg-[#1E2538]"
                title="Zoom In"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setZoomLevel(1)}
                className="p-1 rounded text-[#717E91] hover:text-white hover:bg-[#1E2538] ml-1"
                title="Reset Zoom"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Overlapping Element Switcher Bar */}
          {elementsAtPoint.length > 1 && (
            <div className="p-2 rounded-xl bg-[#090C12] border border-[#1E2538] flex items-center justify-between gap-2 text-xs">
              <span className="text-[11px] text-[#8B949E] font-medium flex items-center gap-1">
                <Layers className="w-3 h-3 text-amber-400" />
                {elementsAtPoint.length} elements at point:
              </span>
              <select
                value={selectedNode?.id || ''}
                onChange={(e) => {
                  const target = elementsAtPoint.find((n) => n.id === e.target.value);
                  if (target) {
                    setSelectedNode(target);
                    expandAncestors(target, inspectionData.hierarchy.rootNode);
                  }
                }}
                className="px-2 py-1 bg-[#131722] border border-[#21293D] rounded-lg text-xs font-mono text-amber-300 focus:outline-none max-w-[200px] truncate"
              >
                {elementsAtPoint.map((n, idx) => (
                  <option key={n.id} value={n.id}>
                    {idx === 0 ? '🎯 Leaf: ' : `Level ${n.depth}: `}
                    {n.className.split('.').pop()}
                    {n.resourceId ? ` (#${n.resourceId.split(':id/').pop()})` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Viewport Canvas Container */}
          <div
            ref={containerRef}
            className="relative flex items-center justify-center bg-[#07090E] border border-[#1A202C] rounded-xl overflow-hidden min-h-[480px] select-none"
          >
            {inspectionData?.screenshot?.previewBase64 ? (
              <div
                className={`relative inline-block transition-transform duration-100 ease-out ${
                  eyedropperActive ? 'cursor-cell' : 'cursor-crosshair'
                }`}
                style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'top center' }}
                onClick={handleViewportClick}
                onMouseMove={handleViewportMouseMove}
                onMouseLeave={() => setHoveredNode(null)}
              >
                <img
                  ref={imageRef}
                  src={getScreenshotSrc(inspectionData.screenshot.previewBase64)}
                  alt="Device Screen Inspection"
                  className="max-h-[640px] w-auto object-contain block pointer-events-auto"
                  onError={(e) => {
                    console.error('UI Inspector: screenshot failed to load');
                    e.target.alt = 'Screenshot failed to load — try re-inspecting';
                  }}
                />

                {/* Hover overlay box */}
                {!eyedropperActive && hoveredOverlayStyle && (
                  <div
                    className="absolute pointer-events-none border-2 border-indigo-400 bg-indigo-500/20 z-20 transition-all duration-75"
                    style={{
                      left: hoveredOverlayStyle.left,
                      top: hoveredOverlayStyle.top,
                      width: hoveredOverlayStyle.width,
                      height: hoveredOverlayStyle.height
                    }}
                  >
                    <span className="absolute -top-5 left-0 px-1 py-0.5 rounded text-[9px] font-mono font-semibold bg-indigo-600 text-white whitespace-nowrap shadow">
                      {hoveredNode?.className?.split('.').pop()}
                    </span>
                  </div>
                )}

                {/* Selected overlay box */}
                {!eyedropperActive && selectedOverlayStyle && (
                  <div
                    className="absolute pointer-events-none border-2 border-amber-400 bg-amber-400/25 z-30 shadow-[0_0_12px_rgba(245,158,11,0.5)] transition-all duration-75"
                    style={{
                      left: selectedOverlayStyle.left,
                      top: selectedOverlayStyle.top,
                      width: selectedOverlayStyle.width,
                      height: selectedOverlayStyle.height
                    }}
                  >
                    <span className="absolute -top-5 left-0 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-[#F59E0B] text-black whitespace-nowrap shadow">
                      {selectedNode?.className?.split('.').pop()}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center p-8 text-center space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-[#131722] border border-[#21293D] flex items-center justify-center text-[#717E91]">
                  <Scan className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-sm font-bold text-white">No Inspection Active</h4>
                  <p className="text-xs text-[#8B949E] max-w-xs">
                    Select an Android device above and click "Inspect Device" to capture screen coordinates and native view hierarchy.
                  </p>
                </div>
                <button
                  onClick={handleInspect}
                  disabled={loading || !currentDevice || isIos}
                  className="mt-2 px-4 py-2 rounded-xl bg-[#F59E0B] hover:bg-[#D97706] text-black font-bold text-xs shadow-md transition-all flex items-center gap-2"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                  <span>Inspect Now</span>
                </button>
              </div>
            )}
          </div>

          {/* Coordinate status bar */}
          <div className="flex items-center justify-between text-[11px] text-[#717E91] font-mono pt-1">
            <span>
              Res: {inspectionData?.device?.screenResolution || '—'}
            </span>
            <span>
              Total Nodes: {inspectionData?.hierarchy?.totalNodes || 0}
            </span>
          </div>
        </div>

        {/* Middle Column: Component Hierarchy Tree (3 cols) */}
        <div className="lg:col-span-3 flex flex-col space-y-3 bg-[#10131B] border border-[#1C2230] p-4 rounded-2xl shadow-sm h-[740px]">
          <div className="flex items-center justify-between pb-2 border-b border-[#1C2230]">
            <span className="text-xs font-bold text-white flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-indigo-400" />
              Hierarchy Tree
            </span>
            {inspectionData?.hierarchy?.totalNodes && (
              <span className="text-[10px] font-mono text-[#8B949E]">
                {inspectionData.hierarchy.totalNodes} nodes
              </span>
            )}
          </div>

          {/* Search Input with Match Indicator */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#64748B] absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search id, class, or text..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-12 py-1.5 bg-[#080B10] border border-[#1C2230] rounded-xl text-xs text-white focus:outline-none focus:border-[#F59E0B] placeholder:text-[#525A6C]"
            />
            {searchQuery && (
              <span className="absolute right-2.5 top-2 text-[10px] font-mono text-amber-400">
                {searchMatches.length}
              </span>
            )}
          </div>

          {/* Hierarchy Tree Content */}
          <div className="flex-1 overflow-y-auto space-y-0.5 pr-1">
            {inspectionData?.hierarchy?.rootNode ? (
              <HierarchyTreeNode
                node={inspectionData.hierarchy.rootNode}
                selectedNode={selectedNode}
                hoveredNode={hoveredNode}
                onSelectNode={(node) => {
                  setSelectedNode(node);
                  expandAncestors(node, inspectionData.hierarchy.rootNode);
                }}
                onHoverNode={setHoveredNode}
                searchQuery={searchQuery}
                expandedIds={expandedIds}
                onToggleExpand={handleToggleExpand}
              />
            ) : (
              <div className="text-center py-16 text-xs text-[#64748B]">
                Hierarchy tree will appear after inspecting device.
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Element Properties & Design QA Spec Inspector (4 cols) */}
        <div className="lg:col-span-4 flex flex-col space-y-4 bg-[#10131B] border border-[#1C2230] p-5 rounded-2xl shadow-sm h-[740px] overflow-y-auto">
          {/* Sub-Tabs: Properties vs Design QA (Figma) */}
          <div className="flex items-center justify-between pb-3 border-b border-[#1C2230]">
            <div className="flex items-center gap-1.5 p-1 bg-[#090C12] border border-[#1A202C] rounded-xl">
              <button
                onClick={() => setActiveInspectorTab('properties')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                  activeInspectorTab === 'properties'
                    ? 'bg-[#1E2538] text-white shadow-sm'
                    : 'text-[#717E91] hover:text-white'
                }`}
              >
                <Sliders className="w-3.5 h-3.5 text-amber-400" />
                <span>Properties</span>
              </button>
              <button
                onClick={() => setActiveInspectorTab('figma-qa')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                  activeInspectorTab === 'figma-qa'
                    ? 'bg-[#1E2538] text-white shadow-sm'
                    : 'text-[#717E91] hover:text-white'
                }`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-400" />
                <span>Figma QA</span>
              </button>
            </div>

            {selectedNode && activeInspectorTab === 'properties' && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(selectedNode.xpath || '');
                    showToast('XPath copied to clipboard');
                  }}
                  className="px-2 py-1 rounded bg-[#1C2230] hover:bg-[#283248] text-[10px] font-semibold text-amber-300 transition-colors"
                  title="Copy generated XPath"
                >
                  XPath
                </button>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(JSON.stringify(selectedNode, null, 2));
                    showToast('Element JSON copied');
                  }}
                  className="px-2 py-1 rounded bg-[#1C2230] hover:bg-[#283248] text-[10px] font-semibold text-[#8B949E] transition-colors"
                  title="Copy full JSON"
                >
                  JSON
                </button>
              </div>
            )}
          </div>

          {/* Breadcrumb Trail & Parent Navigation */}
          {selectedNode && (
            <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-[#090C12] border border-[#161B26]">
              <div className="flex flex-wrap items-center gap-1 text-[10px] font-mono text-[#8B949E] overflow-x-auto max-h-16 flex-1">
                {breadcrumbTrail.map((ancestor, i) => {
                  const isCurrent = i === breadcrumbTrail.length - 1;
                  const short = ancestor.className.split('.').pop();
                  return (
                    <React.Fragment key={ancestor.id}>
                      <button
                        onClick={() => setSelectedNode(ancestor)}
                        className={`hover:text-amber-400 transition-colors ${
                          isCurrent ? 'text-amber-400 font-bold' : 'text-[#64748B]'
                        }`}
                      >
                        {short}
                      </button>
                      {!isCurrent && <ChevronRight className="w-2.5 h-2.5 text-[#424B5D]" />}
                    </React.Fragment>
                  );
                })}
              </div>

              {selectedNode._parent && (
                <button
                  onClick={handleSelectParent}
                  className="p-1 px-2 rounded-lg bg-[#161C2A] hover:bg-[#20293D] text-[10px] text-amber-300 flex items-center gap-1 shrink-0 font-medium"
                  title="Select parent container"
                >
                  <ArrowUp className="w-3 h-3" />
                  <span>Parent</span>
                </button>
              )}
            </div>
          )}

          {/* Tab 1: Detailed Properties */}
          {activeInspectorTab === 'properties' && selectedNode && (
            <div className="space-y-4">
              {/* Group 1: Visual Styling & Color Sampling (Explicit Fidelity) */}
              <div className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-purple-400 flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /> Visual Sampling & Typography
                </span>
                <div className="bg-[#0A0D15] rounded-xl p-2.5 border border-[#181E2E]">
                  {/* Sampled Color Row */}
                  <div className="flex items-center justify-between py-2 border-b border-[#1A202C]/60 px-2 rounded-lg">
                    <div className="flex items-center gap-2.5">
                      <div
                        className="w-5 h-5 rounded border border-white/20 shadow"
                        style={{ backgroundColor: sampledColor?.hex || '#333333' }}
                      />
                      <div className="flex flex-col">
                        <span className="text-[11px] font-semibold text-[#8B949E]">
                          {sampledColor?.isTextEstimate ? 'text-color' : 'sampled-color'}
                        </span>
                        <span className="text-xs font-mono text-[#E6EDF3]">
                          {sampledColor?.hex
                            ? `${sampledColor.hex} (${sampledColor.rgb})`
                            : sampledColor?.source === 'Unavailable'
                            ? 'Could not determine'
                            : 'Click element or eyedropper to sample'}
                        </span>
                        {sampledColor?.sourceNote && (
                          <span className="text-[9px] text-[#64748B] italic">{sampledColor.sourceNote}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <SourceBadge source={sampledColor?.source || 'Estimated'} />
                      {sampledColor?.hex && (
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(sampledColor.hex);
                            showToast(`Copied ${sampledColor.hex}`);
                          }}
                          className="p-1 rounded text-[#717E91] hover:text-white hover:bg-[#1E2538]"
                          title="Copy HEX"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  <PropertyRow
                    label={selectedNode.typography?.fontSize?.status === 'EXACT' ? 'font-size' : 'font-size (approx)'}
                    value={selectedNode.typography?.fontSize?.value || '—'}
                    source={selectedNode.typography?.fontSize?.status || selectedNode.typography?.fontSize?.source || 'Estimated'}
                    note={selectedNode.typography?.fontSize?.note}
                  />
                  <PropertyRow
                    label="font-family"
                    value={selectedNode.typography?.fontFamily?.value || 'Not exposed by UIAutomator'}
                    source={selectedNode.typography?.fontFamily?.status || selectedNode.typography?.fontFamily?.source || 'Unavailable'}
                    note={selectedNode.typography?.fontFamily?.note || 'Android accessibility trees omit typeface names'}
                  />
                  <PropertyRow
                    label="font-weight"
                    value={selectedNode.typography?.fontWeight?.value || 'Not exposed by UIAutomator'}
                    source={selectedNode.typography?.fontWeight?.status || selectedNode.typography?.fontWeight?.source || 'Unavailable'}
                    note={selectedNode.typography?.fontWeight?.note || 'Requires app bytecode instrumentation to read paint styles'}
                  />
                  {selectedNode.typography?.fontStyle && selectedNode.typography?.fontStyle?.value !== 'normal' && (
                    <PropertyRow
                      label="font-style"
                      value={selectedNode.typography?.fontStyle?.value}
                      source={selectedNode.typography?.fontStyle?.status || selectedNode.typography?.fontStyle?.source || 'Inferred'}
                      note={selectedNode.typography?.fontStyle?.note}
                    />
                  )}
                  {selectedNode.typography?.runtime && (
                    <PropertyRow
                      label="runtime-jdwp"
                      value={selectedNode.typography.runtime.supported ? `Connected (${selectedNode.typography.runtime.vmName || 'Dalvik'} VM, PID ${selectedNode.typography.runtime.pid})` : 'Unsupported'}
                      source={selectedNode.typography.runtime.supported ? 'Native' : 'Unavailable'}
                      note={selectedNode.typography.runtime.supported ? `JDWP ${selectedNode.typography.runtime.jdwpVersion} handshake verified; app running with android:debuggable=true` : selectedNode.typography.runtime.reason}
                    />
                  )}

                  {/* Runtime Inspection Action for text nodes */}
                  {isTextNode(selectedNode) && (
                    <div className="pt-2.5 mt-2 border-t border-[#181E2E] flex items-center justify-between">
                      <div className="flex flex-col">
                        <span className="text-[10px] text-[#A5B4FC] font-semibold flex items-center gap-1">
                          <Sparkles className="w-3 h-3 text-indigo-400" /> Live Heap Inspection
                        </span>
                        <span className="text-[9px] text-[#64748B]">
                          Query Typeface & Color from ART via JDWP (debuggable apps)
                        </span>
                      </div>
                      <button
                        onClick={handleInspectRuntimeTypography}
                        disabled={runtimeInspecting}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1.5 transition-all shadow ${
                          runtimeInspecting
                            ? 'bg-[#181E2E] text-[#64748B] cursor-wait'
                            : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-500/20'
                        }`}
                        title="Connect to running debuggable app via JDWP to extract exact Typeface and text color"
                      >
                        {runtimeInspecting ? (
                          <>
                            <RefreshCw className="w-3 h-3 animate-spin" />
                            <span>Extracting...</span>
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-3 h-3" />
                            <span>Inspect Runtime</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Group 2: Identity & Selectors */}
              <div className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#F59E0B] flex items-center gap-1">
                  <Code2 className="w-3 h-3" /> Identity & Selectors
                </span>
                <div className="bg-[#0A0D15] rounded-xl p-2.5 border border-[#181E2E]">
                  <PropertyRow
                    label="resource-id"
                    value={selectedNode.resourceId}
                    source={selectedNode.propertySources?.resourceId || 'Native'}
                  />
                  <PropertyRow
                    label="class"
                    value={selectedNode.className}
                    source={selectedNode.propertySources?.className || 'Native'}
                  />
                  <PropertyRow
                    label="package"
                    value={selectedNode.package}
                    source={selectedNode.propertySources?.package || 'Native'}
                  />
                  <PropertyRow
                    label="XPath"
                    value={selectedNode.xpath}
                    source="Native"
                  />
                </div>
              </div>

              {/* Group 3: Content & Accessibility */}
              <div className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#A5B4FC] flex items-center gap-1">
                  <Type className="w-3 h-3" /> Content & Accessibility
                </span>
                <div className="bg-[#0A0D15] rounded-xl p-2.5 border border-[#181E2E]">
                  <PropertyRow
                    label="text"
                    value={selectedNode.text}
                    source={selectedNode.propertySources?.text || 'Native'}
                    monospace={false}
                  />
                  <PropertyRow
                    label="content-desc"
                    value={selectedNode.contentDesc}
                    source={selectedNode.propertySources?.contentDesc || 'Native'}
                    monospace={false}
                  />
                </div>
              </div>

              {/* Group 4: Geometry & Dimensions */}
              <div className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1">
                  <Layout className="w-3 h-3" /> Layout & Bounds
                </span>
                <div className="bg-[#0A0D15] rounded-xl p-2.5 border border-[#181E2E] space-y-2">
                  <PropertyRow
                    label="bounds"
                    value={selectedNode.bounds?.raw}
                    source={selectedNode.propertySources?.bounds || 'Native'}
                  />
                  <PropertyRow
                    label="dimensions"
                    value={`${selectedNode.bounds?.width} × ${selectedNode.bounds?.height} px`}
                    source="Native"
                  />
                  <PropertyRow
                    label="center"
                    value={`(${Math.round(selectedNode.bounds?.left + selectedNode.bounds?.width / 2)}, ${Math.round(selectedNode.bounds?.top + selectedNode.bounds?.height / 2)})`}
                    source="Native"
                  />

                  {/* Geometry Box Diagram */}
                  <div className="pt-2 border-t border-[#181E2E] flex justify-center">
                    <div className="border border-emerald-500/40 bg-emerald-500/5 rounded-lg p-2 text-center text-[10px] font-mono text-emerald-300 w-full max-w-[240px]">
                      <div className="text-[#64748B] text-[9px]">top: {selectedNode.bounds?.top}</div>
                      <div className="flex items-center justify-between py-1 px-2">
                        <span className="text-[#64748B] text-[9px]">{selectedNode.bounds?.left}</span>
                        <span className="font-bold text-white text-[11px]">
                          {selectedNode.bounds?.width} × {selectedNode.bounds?.height}
                        </span>
                        <span className="text-[#64748B] text-[9px]">{selectedNode.bounds?.right}</span>
                      </div>
                      <div className="text-[#64748B] text-[9px]">bottom: {selectedNode.bounds?.bottom}</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Group 5: Interaction States */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-sky-400 flex items-center gap-1">
                    <MousePointerClick className="w-3 h-3" /> Interaction States
                  </span>
                  <SourceBadge source="Native" />
                </div>
                <div className="grid grid-cols-2 gap-1.5 bg-[#0A0D15] rounded-xl p-2.5 border border-[#181E2E] text-xs">
                  {Object.entries(selectedNode.states || {}).map(([key, active]) => (
                    <div
                      key={key}
                      className={`flex items-center justify-between px-2 py-1 rounded text-[11px] ${
                        active
                          ? 'bg-emerald-500/10 text-emerald-300 font-semibold'
                          : 'bg-[#121622] text-[#64748B]'
                      }`}
                    >
                      <span className="capitalize">{key}</span>
                      <span className="font-mono text-[10px]">{active ? 'true' : 'false'}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Tab 2: Design QA / Figma Spec Comparison */}
          {activeInspectorTab === 'figma-qa' && selectedNode && (
            <div className="space-y-4">
              <div className="p-3 rounded-xl bg-[#0A0D15] border border-[#1A202C] space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white flex items-center gap-1.5">
                    <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-400" />
                    Enter Expected Figma Values
                  </span>
                  <button
                    onClick={handleCopyQaReport}
                    className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-[11px] shadow flex items-center gap-1.5"
                  >
                    <FileText className="w-3 h-3" />
                    <span>Copy QA Report</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <label className="text-[10px] text-[#8B949E] font-medium">Expected Width (px)</label>
                    <input
                      type="number"
                      placeholder="e.g. 400"
                      value={expectedSpecs.width}
                      onChange={(e) => setExpectedSpecs({ ...expectedSpecs, width: e.target.value })}
                      className="w-full mt-1 px-2.5 py-1 bg-[#131722] border border-[#21293D] rounded-lg text-xs text-white focus:outline-none focus:border-indigo-400 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-[#8B949E] font-medium">Expected Height (px)</label>
                    <input
                      type="number"
                      placeholder="e.g. 80"
                      value={expectedSpecs.height}
                      onChange={(e) => setExpectedSpecs({ ...expectedSpecs, height: e.target.value })}
                      className="w-full mt-1 px-2.5 py-1 bg-[#131722] border border-[#21293D] rounded-lg text-xs text-white focus:outline-none focus:border-indigo-400 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-[#8B949E] font-medium">Expected Font (sp)</label>
                    <input
                      type="number"
                      placeholder="e.g. 16"
                      value={expectedSpecs.fontSize}
                      onChange={(e) => setExpectedSpecs({ ...expectedSpecs, fontSize: e.target.value })}
                      className="w-full mt-1 px-2.5 py-1 bg-[#131722] border border-[#21293D] rounded-lg text-xs text-white focus:outline-none focus:border-indigo-400 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-[#8B949E] font-medium">Expected Color (HEX)</label>
                    <input
                      type="text"
                      placeholder="#1A73E8"
                      value={expectedSpecs.colorHex}
                      onChange={(e) => setExpectedSpecs({ ...expectedSpecs, colorHex: e.target.value })}
                      className="w-full mt-1 px-2.5 py-1 bg-[#131722] border border-[#21293D] rounded-lg text-xs text-white focus:outline-none focus:border-indigo-400 font-mono uppercase"
                    />
                  </div>
                </div>
              </div>

              {/* Comparison Results Table */}
              <div className="space-y-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-white">
                  Spec Verification Results
                </span>

                {figmaComparison && figmaComparison.length > 0 ? (
                  <div className="space-y-1.5">
                    {figmaComparison.map((item, idx) => (
                      <div
                        key={idx}
                        className={`p-2.5 rounded-xl border flex items-center justify-between text-xs ${
                          item.status === 'MATCH'
                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                            : item.status === 'MISMATCH'
                            ? 'bg-rose-500/10 border-rose-500/30 text-rose-200'
                            : item.status === 'ESTIMATED CHECK'
                            ? 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                            : 'bg-[#131722] border-[#21293D] text-[#94A3B8]'
                        }`}
                      >
                        <div className="flex flex-col min-w-0 pr-2">
                          <span className="text-[11px] font-bold text-white">{item.prop}</span>
                          <span className="text-[11px] font-mono">
                            Exp: {item.expected} vs Act: {item.actual}
                          </span>
                          {item.note && <span className="text-[9px] text-[#64748B] italic">{item.note}</span>}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span className="font-mono text-[10px] font-bold">{item.delta}</span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
                              item.status === 'MATCH'
                                ? 'bg-emerald-500 text-black'
                                : item.status === 'MISMATCH'
                                ? 'bg-rose-500 text-white'
                                : item.status === 'ESTIMATED CHECK'
                                ? 'bg-amber-400 text-black'
                                : item.status === 'INFERRED'
                                ? 'bg-indigo-500 text-white'
                                : 'bg-gray-700 text-gray-300'
                            }`}
                          >
                            {item.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-6 rounded-xl bg-[#090C12] border border-[#161B26] text-center text-xs text-[#64748B]">
                    Enter one or more expected Figma values above to see real-time spec compliance.
                  </div>
                )}
              </div>
            </div>
          )}

          {!selectedNode && (
            <div className="text-center py-24 text-xs text-[#64748B] space-y-2">
              <MousePointerClick className="w-6 h-6 mx-auto text-[#424B5D]" />
              <p>Click any element on the screenshot or choose a node in the hierarchy tree to inspect its attributes.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
