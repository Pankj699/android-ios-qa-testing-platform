import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Terminal,
  Download,
  Trash2,
  Copy,
  Search,
  Check,
  ArrowDown,
  ChevronRight,
  ChevronDown,
  Activity,
  Layers,
  Globe,
  AlertCircle,
  Clock,
  Code2,
  X,
  FileText,
  ShieldCheck,
  HardDrive,
  Send,
  CornerDownRight,
  Maximize2,
  Minimize2,
  Flame,
  AlertTriangle
} from 'lucide-react';

/**
 * Standard HTTP Status Descriptions Map
 */
export const HTTP_STATUS_TEXTS = {
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content',
  301: 'Moved Permanently',
  302: 'Found',
  304: 'Not Modified',
  307: 'Temporary Redirect',
  308: 'Permanent Redirect',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  408: 'Request Timeout',
  409: 'Conflict',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout'
};

/**
 * Sensitive Data Masking Utility
 * Masks passwords, secrets, JWT tokens, Bearer auth, cookies, session keys
 */
export function sanitizeSensitiveData(text) {
  if (!text || typeof text !== 'string') return text;

  return text
    // Header format: Authorization: Bearer XYZ or Basic XYZ
    .replace(/(authorization\s*:\s*Bearer\s+)[^\s\r\n]+/gi, '$1[MASKED]')
    .replace(/(authorization\s*:\s*Basic\s+)[^\s\r\n]+/gi, '$1[MASKED]')
    .replace(/(bearer\s+)[a-zA-Z0-9_\-\.]{4,}/gi, '$1[MASKED]')
    .replace(/(basic\s+)[a-zA-Z0-9+/=]{4,}/gi, '$1[MASKED]')
    // JSON keys: "password": "...", "access_token": "...", "token": "...", etc.
    .replace(/("?(?:password|access_token|accessToken|refresh_token|refreshToken|secret|client_secret|apiKey|api_key|sessionToken|cookie|set-cookie|token|jwt|creditCard|cvv|auth)"?\s*:\s*)"([^"]*)"/gi, '$1"********"')
    // Key=Value query/log formats: password=XYZ&token=ABC
    .replace(/((?:password|access_token|accessToken|refresh_token|refreshToken|secret|client_secret|apiKey|api_key|sessionToken|cookie|token|jwt)=)[^&\s\r\n]+/gi, '$1********');
}

/**
 * Byte Size Formatter
 */
export function formatBytes(bytes) {
  if (bytes === null || bytes === undefined || isNaN(bytes)) return null;
  const num = Number(bytes);
  if (num < 1024) return `${num} B`;
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
  return `${(num / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Duration Formatter
 */
export function formatDuration(msOrStr) {
  if (!msOrStr) return null;
  if (typeof msOrStr === 'string' && (msOrStr.includes('ms') || msOrStr.includes('s'))) {
    return msOrStr;
  }
  const num = Number(msOrStr);
  if (isNaN(num)) return String(msOrStr);
  if (num >= 1000) return `${(num / 1000).toFixed(2)} s`;
  return `${num} ms`;
}

/**
 * Extract Query Parameters from URL string
 */
export function extractQueryParams(urlString) {
  if (!urlString || typeof urlString !== 'string') return null;
  try {
    const qIndex = urlString.indexOf('?');
    if (qIndex === -1) return null;
    const search = urlString.substring(qIndex + 1);
    if (!search.trim()) return null;
    const params = new URLSearchParams(search);
    const entries = [];
    for (const [key, value] of params.entries()) {
      entries.push({ key, value: sanitizeSensitiveData(value) });
    }
    return entries.length > 0 ? entries : null;
  } catch (e) {
    return null;
  }
}

/**
 * Headers Formatter
 */
export function formatHeaders(headers) {
  if (!headers) return null;
  if (typeof headers === 'string') {
    return sanitizeSensitiveData(headers.trim());
  }
  if (typeof headers === 'object') {
    const lines = [];
    for (const [k, v] of Object.entries(headers)) {
      const lowerKey = k.toLowerCase();
      let valStr = String(v);
      if (lowerKey.includes('auth') || lowerKey.includes('cookie') || lowerKey.includes('token') || lowerKey.includes('secret') || lowerKey.includes('key')) {
        valStr = valStr.startsWith('Bearer ') ? 'Bearer [MASKED]' : valStr.startsWith('Basic ') ? 'Basic [MASKED]' : '[MASKED]';
      } else {
        valStr = sanitizeSensitiveData(valStr);
      }
      lines.push(`${k}: ${valStr}`);
    }
    return lines.length > 0 ? lines.join('\n') : null;
  }
  return null;
}

const MAX_PAYLOAD_SIZE = 1024 * 1024; // 1 MB payload protection limit

/**
 * Payload Body Formatter with JSON Pretty-Printing, Binary Detection, and Size Limits
 */
export function formatPayloadBody(body, contentType = '') {
  if (body === null || body === undefined || body === '') return null;

  // Binary Detection
  const lowerType = (contentType || '').toLowerCase();
  if (
    lowerType.startsWith('image/') ||
    lowerType.startsWith('audio/') ||
    lowerType.startsWith('video/') ||
    lowerType.includes('octet-stream') ||
    lowerType.includes('pdf') ||
    lowerType.includes('protobuf')
  ) {
    return {
      isBinary: true,
      contentType: contentType || 'application/octet-stream',
      text: `[Binary Content: ${contentType || 'application/octet-stream'}]`
    };
  }

  let bodyStr = typeof body === 'object' ? JSON.stringify(body, null, 2) : String(body);

  // Large Payload Truncation Protection
  let isTruncated = false;
  const originalSize = bodyStr.length;
  if (bodyStr.length > MAX_PAYLOAD_SIZE) {
    isTruncated = true;
    bodyStr = bodyStr.substring(0, MAX_PAYLOAD_SIZE) + `\n\n... [TRUNCATED — original size: ${formatBytes(originalSize)}]`;
  }

  // Attempt JSON parsing and pretty printing
  let isJson = false;
  if (typeof body === 'string' && (bodyStr.trim().startsWith('{') || bodyStr.trim().startsWith('['))) {
    try {
      const parsed = JSON.parse(bodyStr);
      bodyStr = JSON.stringify(parsed, null, 2);
      isJson = true;
    } catch (e) {
      // Retain formatted string
    }
  } else if (typeof body === 'object') {
    isJson = true;
  }

  return {
    isBinary: false,
    isJson,
    contentType: contentType || (isJson ? 'application/json' : 'text/plain'),
    text: sanitizeSensitiveData(bodyStr),
    isTruncated,
    originalSize
  };
}

/**
 * Formats the complete underlying structured HTTP transaction object for the JSON view
 */
export function getStructuredTransactionJson(entry) {
  if (!entry || !entry.apiDetails) return null;
  const api = entry.apiDetails;

  let queryObj = null;
  if (api.queryParams && api.queryParams.length > 0) {
    queryObj = {};
    api.queryParams.forEach(q => {
      queryObj[q.key] = q.value;
    });
  }

  let reqHeaders = null;
  if (api.requestHeaders) {
    if (typeof api.requestHeaders === 'string') {
      const lines = api.requestHeaders.split('\n');
      const hObj = {};
      lines.forEach(l => {
        const idx = l.indexOf(':');
        if (idx !== -1) {
          hObj[l.substring(0, idx).trim()] = l.substring(idx + 1).trim();
        } else if (l.trim()) {
          hObj[l.trim()] = '';
        }
      });
      reqHeaders = Object.keys(hObj).length > 0 ? hObj : null;
    } else if (typeof api.requestHeaders === 'object') {
      reqHeaders = api.requestHeaders;
    }
  }

  let respHeaders = null;
  if (api.responseHeaders) {
    if (typeof api.responseHeaders === 'string') {
      const lines = api.responseHeaders.split('\n');
      const hObj = {};
      lines.forEach(l => {
        const idx = l.indexOf(':');
        if (idx !== -1) {
          hObj[l.substring(0, idx).trim()] = l.substring(idx + 1).trim();
        } else if (l.trim()) {
          hObj[l.trim()] = '';
        }
      });
      respHeaders = Object.keys(hObj).length > 0 ? hObj : null;
    } else if (typeof api.responseHeaders === 'object') {
      respHeaders = api.responseHeaders;
    }
  }

  let reqBody = null;
  if (api.requestBody) {
    if (api.requestBody.isBinary) {
      reqBody = api.requestBody.text;
    } else if (api.requestBody.text) {
      const text = api.requestBody.text;
      if (typeof text === 'string' && (text.trim().startsWith('{') || text.trim().startsWith('['))) {
        try {
          reqBody = JSON.parse(text);
        } catch (e) {
          reqBody = text;
        }
      } else {
        reqBody = text;
      }
    }
  }

  let respBody = null;
  if (api.responseBody) {
    if (api.responseBody.isBinary) {
      respBody = api.responseBody.text;
    } else if (api.responseBody.text) {
      const text = api.responseBody.text;
      if (typeof text === 'string' && (text.trim().startsWith('{') || text.trim().startsWith('['))) {
        try {
          respBody = JSON.parse(text);
        } catch (e) {
          respBody = text;
        }
      } else {
        respBody = text;
      }
    }
  }

  return {
    requestId: api.requestId || entry.id,
    timestamp: entry.time || new Date().toISOString(),
    request: {
      method: api.method || 'GET',
      url: api.endpoint || '',
      queryParams: queryObj,
      headers: reqHeaders,
      body: reqBody
    },
    response: {
      status: api.status || entry.status || 200,
      statusText: api.statusText || HTTP_STATUS_TEXTS[api.status || entry.status || 200] || 'OK',
      duration: api.duration || entry.duration || null,
      size: api.responseSize || null,
      headers: respHeaders,
      body: respBody
    },
    error: api.error || null
  };
}

/**
 * Tokenizes a single line of formatted JSON into syntax-highlighted token segments
 * Postman-style color mapping:
 * - Property keys: Light blue (#79C0FF)
 * - String values: Light green (#A5D6A7)
 * - Numeric values: Orange (#FFB86C)
 * - Boolean values: Purple (#C792EA)
 * - Null values: Muted red (#F07178)
 * - Brackets, braces, colons, commas: Light gray (#C9D1D9)
 */
export function tokenizeJsonLine(line) {
  if (typeof line !== 'string') return [{ type: 'text', text: String(line) }];
  const JSON_TOKEN_REGEX = /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}[\],:])/g;
  const elements = [];
  let lastIndex = 0;
  let match;

  while ((match = JSON_TOKEN_REGEX.exec(line)) !== null) {
    if (match.index > lastIndex) {
      elements.push({ type: 'text', text: line.substring(lastIndex, match.index) });
    }

    const token = match[0];
    if (token.startsWith('"')) {
      if (token.endsWith(':')) {
        const colonIdx = token.lastIndexOf(':');
        elements.push({ type: 'key', text: token.substring(0, colonIdx) });
        elements.push({ type: 'punctuation', text: token.substring(colonIdx) });
      } else {
        elements.push({ type: 'string', text: token });
      }
    } else if (token === 'true' || token === 'false') {
      elements.push({ type: 'boolean', text: token });
    } else if (token === 'null') {
      elements.push({ type: 'null', text: token });
    } else if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(token)) {
      elements.push({ type: 'number', text: token });
    } else {
      elements.push({ type: 'punctuation', text: token });
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < line.length) {
    elements.push({ type: 'text', text: line.substring(lastIndex) });
  }

  return elements.length > 0 ? elements : [{ type: 'text', text: line }];
}

/**
 * Log entry parser and category normalizer
 */
export function parseLogEntry(rawLog, index) {
  const isObj = typeof rawLog === 'object' && rawLog !== null;
  const rawText = isObj ? (rawLog.text || '') : String(rawLog);
  const time = isObj ? (rawLog.time || '') : (rawText.match(/^\[(\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)\]/)?.[1] || rawText.match(/(\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)/)?.[1] || '');
  const level = isObj ? (rawLog.level || 'INFO') : (rawText.match(/\[(INFO|WARN|ERROR|DEBUG)\]/)?.[1] || (/\s+E\s+/.test(rawText) || rawText.includes('[ERROR]') ? 'ERROR' : 'INFO'));

  // Strip leading timestamp and log level prefix for clean display
  let cleanText = rawText
    .replace(/^\[\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?\]\s*/, '')
    .replace(/^\[(INFO|WARN|ERROR|DEBUG)\]\s*/, '')
    .replace(/^\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3}\s+\d+\s+\d+\s+[VDIWE]\s+/, '');

  let category = 'APP LOGCAT';
  let apiDetails = isObj ? (rawLog.api ? { ...rawLog.api } : (rawLog.apiDetails ? { ...rawLog.apiDetails } : null)) : null;
  let status = isObj ? rawLog.status : null;
  let duration = isObj ? rawLog.duration : null;

  // 1. Structured API object passed directly
  if (apiDetails) {
    category = 'API';
    status = apiDetails.status || status;
    duration = apiDetails.durationMs ? formatDuration(apiDetails.durationMs) : formatDuration(apiDetails.duration || duration);
    const queryParams = extractQueryParams(apiDetails.endpoint || apiDetails.url);
    const isExplicitRequest = apiDetails.type === 'request' || (!apiDetails.response && !apiDetails.status && apiDetails.request);
    const isCompletedType = apiDetails.type === 'completed' || (!apiDetails.type && (apiDetails.response || apiDetails.status));
    const isFull = apiDetails.isFullTransaction !== undefined ? apiDetails.isFullTransaction : (isCompletedType && !isExplicitRequest);

    apiDetails = {
      ...apiDetails,
      requestId: apiDetails.requestId || (isObj && rawLog.requestId ? rawLog.requestId : null),
      endpoint: apiDetails.endpoint || apiDetails.url,
      method: (apiDetails.method || apiDetails.request?.method || 'GET').toUpperCase(),
      queryParams: queryParams || (apiDetails.query ? Object.entries(apiDetails.query).map(([key, value]) => ({ key, value: String(value) })) : null),
      requestHeaders: formatHeaders(apiDetails.request?.headers || apiDetails.requestHeaders || apiDetails.headers),
      requestBody: formatPayloadBody(apiDetails.request?.body || apiDetails.requestBody || apiDetails.body, apiDetails.request?.contentType || apiDetails.requestContentType),
      responseHeaders: formatHeaders(apiDetails.response?.headers || apiDetails.responseHeaders),
      responseBody: formatPayloadBody(apiDetails.response?.body || apiDetails.responseBody || apiDetails.response, apiDetails.response?.contentType || apiDetails.responseContentType),
      responseSize: apiDetails.response?.bodySize ? formatBytes(apiDetails.response.bodySize) : (apiDetails.responseSize ? (typeof apiDetails.responseSize === 'number' ? formatBytes(apiDetails.responseSize) : apiDetails.responseSize) : null),
      status: status || 200,
      statusText: apiDetails.response?.statusText || apiDetails.statusText || HTTP_STATUS_TEXTS[status || 200] || 'OK',
      duration: duration || null,
      error: apiDetails.error || null,
      type: apiDetails.type || (isExplicitRequest ? 'request' : 'completed'),
      isFullTransaction: isFull
    };
  }
  // 2. Structured Volley HTTP Transaction in log string
  else if (cleanText.includes('[VOLLEY_HTTP_TRANSACTION]') || cleanText.includes('VOLLEY_HTTP_TRANSACTION:') || cleanText.includes('[API_TRANSACTION]')) {
    category = 'API';
    try {
      const jsonStart = cleanText.indexOf('{');
      if (jsonStart !== -1) {
        const jsonStr = cleanText.substring(jsonStart);
        const parsedData = JSON.parse(jsonStr);
        const method = (parsedData.method || parsedData.request?.method || 'GET').toUpperCase();
        const endpoint = parsedData.url || parsedData.endpoint || '';
        status = parsedData.response?.status || parsedData.status || 200;
        duration = parsedData.durationMs ? formatDuration(parsedData.durationMs) : formatDuration(parsedData.duration || null);
        const queryParams = extractQueryParams(endpoint) || (parsedData.query ? Object.entries(parsedData.query).map(([k, v]) => ({ key: k, value: String(v) })) : null);
        const requestHeaders = formatHeaders(parsedData.request?.headers || parsedData.requestHeaders || parsedData.headers);
        const requestBody = formatPayloadBody(parsedData.request?.body || parsedData.requestBody || parsedData.body, parsedData.request?.contentType);
        const responseHeaders = formatHeaders(parsedData.response?.headers || parsedData.responseHeaders);
        const responseBody = formatPayloadBody(parsedData.response?.body || parsedData.responseBody || parsedData.response, parsedData.response?.contentType);
        const responseSize = parsedData.response?.bodySize ? formatBytes(parsedData.response.bodySize) : (parsedData.responseSize ? (typeof parsedData.responseSize === 'number' ? formatBytes(parsedData.responseSize) : parsedData.responseSize) : null);

        apiDetails = {
          requestId: parsedData.requestId || null,
          method,
          endpoint,
          queryParams,
          requestHeaders,
          requestBody,
          status,
          statusText: parsedData.response?.statusText || HTTP_STATUS_TEXTS[status] || 'OK',
          duration,
          responseSize,
          responseHeaders,
          responseBody,
          error: parsedData.error || null,
          type: 'completed',
          isFullTransaction: true,
          summary: `${method} ${endpoint}`
        };
      }
    } catch (e) {}
  }
  // 3. Android Volley Network Response:
  // e.g. "Volley : [4608] NetworkUtility.logSlowRequests: HTTP response for request=<[ ] http://192.168.0.110/.../generateAiFlyerImage 0x85adf673 NORMAL 19> [lifetime=39908], [size=119], [rc=200], [retryCount=0]"
  // or "BasicNetwork.logSlowRequests: HTTP response for request=<[POST] http://... > [lifetime=842], [size=18400], [rc=200]"
  else if (cleanText.includes('HTTP response for request=<') || (cleanText.includes('Volley') && cleanText.includes('[rc='))) {
    category = 'API';
    const urlMatch = cleanText.match(/request=<\s*(?:\[([^\]]*)\])?\s*(https?:\/\/[^\s>]+)/i);
    const rcMatch = cleanText.match(/\[rc=(\d{3})\]/i);
    const lifeMatch = cleanText.match(/\[lifetime=(\d+)\]/i);
    const sizeMatch = cleanText.match(/\[size=(\d+)\]/i);

    const endpoint = urlMatch ? urlMatch[2] : cleanText;
    const explicitMethod = urlMatch && urlMatch[1] && urlMatch[1].trim() ? urlMatch[1].trim() : '';
    const method = explicitMethod && ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(explicitMethod.toUpperCase())
      ? explicitMethod.toUpperCase()
      : (endpoint.includes('generate') || endpoint.includes('add') || endpoint.includes('upload') || endpoint.includes('remove') || endpoint.includes('create') ? 'POST' : 'GET');

    if (rcMatch) {
      status = parseInt(rcMatch[1], 10);
    }
    if (lifeMatch) {
      duration = formatDuration(parseInt(lifeMatch[1], 10));
    }
    const responseSize = sizeMatch ? formatBytes(parseInt(sizeMatch[1], 10)) : null;
    const queryParams = extractQueryParams(endpoint);

    apiDetails = {
      method,
      endpoint,
      queryParams,
      status: status || 200,
      statusText: HTTP_STATUS_TEXTS[status || 200] || 'OK',
      duration: duration || null,
      responseSize,
      requestHeaders: null,
      requestBody: null,
      responseHeaders: null,
      responseBody: null,
      type: 'response',
      summary: `${method} ${endpoint}`
    };
  }
  // 3. Android App-Level API Log patterns:
  // e.g. "API_TO_CALL: URL :- http://192.168.0.110/.../generateAiFlyerImage Request: { ... }"
  // or "API_TO_CALL: http://.../generatePhotoshoot\tRequest: "
  else if (/API_TO_CALL:\s*(?:URL\s*:-\s*)?(https?:\/\/[^\s]+)/i.test(cleanText) || /API_URL\s*:\s*(https?:\/\/[^\s]+)/i.test(cleanText)) {
    category = 'API';
    const urlMatch = cleanText.match(/(https?:\/\/[^\s]+)/i);
    const endpoint = urlMatch ? urlMatch[1] : cleanText;
    const method = endpoint.includes('generate') || endpoint.includes('add') || endpoint.includes('create') || endpoint.includes('remove') || endpoint.includes('upload') || endpoint.includes('sync') || endpoint.includes('update') || endpoint.includes('set') ? 'POST' : 'GET';
    const queryParams = extractQueryParams(endpoint);

    // Extract request body if included in log line e.g. "Request: { ... }"
    let requestBody = null;
    const reqBodyMatch = cleanText.match(/Request:\s*(\{[\s\S]*\}|\[[\s\S]*\])/i);
    if (reqBodyMatch) {
      requestBody = formatPayloadBody(reqBodyMatch[1]);
    }

    apiDetails = {
      method,
      endpoint,
      queryParams,
      requestHeaders: null,
      requestBody,
      status: 200,
      statusText: 'OK',
      responseHeaders: null,
      responseBody: null,
      type: 'request',
      summary: `${method} ${endpoint}`
    };
    status = 200;
  }
  // 4. OkHttp / Retrofit HTTP Interceptor patterns
  else if (cleanText.includes('--> POST') || cleanText.includes('--> GET') || cleanText.includes('--> PUT') || cleanText.includes('--> DELETE') || cleanText.includes('--> PATCH')) {
    category = 'API';
    const match = cleanText.match(/-->\s+(POST|GET|PUT|DELETE|PATCH)\s+([^\s]+)/i);
    if (match) {
      const method = match[1].toUpperCase();
      const endpoint = match[2];
      apiDetails = {
        method,
        endpoint,
        queryParams: extractQueryParams(endpoint),
        requestHeaders: null,
        requestBody: null,
        type: 'request',
        summary: `${method} ${endpoint}`
      };
    }
  } else if (cleanText.includes('<-- 200') || cleanText.includes('<-- 201') || cleanText.includes('<-- 204') || cleanText.includes('<-- 400') || cleanText.includes('<-- 401') || cleanText.includes('<-- 403') || cleanText.includes('<-- 404') || cleanText.includes('<-- 500') || cleanText.includes('<-- 502') || cleanText.includes('<-- 503')) {
    category = 'API';
    const match = cleanText.match(/<--\s+(\d{3})\s+([^\(]+)(?:\(([^)]+)\))?/i);
    if (match) {
      status = parseInt(match[1], 10);
      duration = match[3] ? formatDuration(match[3]) : null;
      apiDetails = {
        status,
        statusText: match[2]?.trim() || HTTP_STATUS_TEXTS[status] || 'OK',
        duration,
        type: 'response',
        summary: `Response ${status} ${match[2]?.trim() || ''}`
      };
    }
  } else if (/^\[API\]\s+(POST|GET|PUT|DELETE|PATCH)\s+([^\s]+)(?:\s+(\d{3}))?(?:\s+\(([^)]+)\))?/i.test(cleanText)) {
    category = 'API';
    const match = cleanText.match(/^\[API\]\s+(POST|GET|PUT|DELETE|PATCH)\s+([^\s]+)(?:\s+(\d{3}))?(?:\s+\(([^)]+)\))?/i);
    if (match) {
      const method = match[1].toUpperCase();
      const endpoint = match[2];
      status = match[3] ? parseInt(match[3], 10) : 200;
      duration = match[4] ? formatDuration(match[4]) : null;
      apiDetails = {
        method,
        endpoint,
        queryParams: extractQueryParams(endpoint),
        status,
        statusText: HTTP_STATUS_TEXTS[status] || 'OK',
        duration,
        type: 'completed',
        summary: `${method} ${endpoint}`
      };
    }
  }
  // 5. Fatal App Crash detection
  else if (
    cleanText.includes('FATAL EXCEPTION') ||
    cleanText.includes('AndroidRuntime: FATAL') ||
    (isObj && (rawLog.type === 'APP_CRASH' || rawLog.category === 'APP CRASH'))
  ) {
    category = 'APP CRASH';
    status = 'CRASH';
  }
  // 6. Normal Error detection
  else if (
    level === 'ERROR' ||
    cleanText.includes('[ERROR]') ||
    cleanText.toLowerCase().includes('failed') ||
    cleanText.startsWith('✕')
  ) {
    category = 'ERROR';
  }
  // 7. QA Actions
  else if (
    cleanText.startsWith('✓') ||
    cleanText.startsWith('▶') ||
    cleanText.startsWith('ℹ') ||
    cleanText.includes('Checking Prerequisites') ||
    cleanText.includes('Validating Connected') ||
    cleanText.includes('Analyzing AAB') ||
    cleanText.includes('Installing') ||
    cleanText.includes('Launching') ||
    cleanText.includes('Monitoring AssetPackHelper') ||
    cleanText.includes('Final PAD Verification') ||
    cleanText.includes('TEST EXECUTION:') ||
    cleanText.includes('Asset pack') ||
    cleanText.includes('[Bundletool]') ||
    cleanText.includes('[Install]') ||
    cleanText.includes('ADB')
  ) {
    category = 'QA ACTION';
  }

  // Extract duration from text if not already found e.g. "(842ms)" or "in 1.2s"
  if (!duration) {
    const durMatch = cleanText.match(/\((\d+(?:\.\d+)?\s*(?:ms|s))\)/i) || cleanText.match(/in\s+(\d+(?:\.\d+)?\s*(?:ms|s))/i);
    if (durMatch) duration = formatDuration(durMatch[1]);
  }

  const isExpandable = !!(
    apiDetails ||
    (isObj && rawLog.details) ||
    cleanText.includes('\n') ||
    cleanText.length > 90 ||
    category === 'ERROR' ||
    category === 'APP CRASH'
  );

  return {
    id: `log-${index}`,
    index,
    rawLog,
    rawText: sanitizeSensitiveData(rawText),
    cleanText: sanitizeSensitiveData(cleanText),
    time: time || '',
    level,
    category,
    status,
    duration,
    apiDetails: apiDetails ? {
      ...apiDetails,
      endpoint: apiDetails.endpoint ? sanitizeSensitiveData(apiDetails.endpoint) : undefined
    } : null,
    isExpandable
  };
}

/**
 * Generates developer-friendly formatted plain-text crash report
 */
export function formatCrashReport(crashEntry, options = {}) {
  const c = crashEntry?.crashDetails || {};
  const appName = options.applicationName || c.process || 'Android Application';
  const pkgName = options.packageName || c.process || 'Unknown Package';
  const deviceName = options.device || options.serial || 'Android Device';

  const report = [
    'ANDROID APP CRASH REPORT',
    '========================',
    '',
    'Application:',
    appName,
    '',
    'Package:',
    pkgName,
    '',
    'Device:',
    deviceName,
    '',
    'PID:',
    c.pid || 'N/A',
    '',
    'Timestamp:',
    crashEntry?.time || new Date().toISOString(),
    '',
    'Thread:',
    c.thread || 'main',
    '',
    'Exception:',
    c.exceptionType || 'java.lang.RuntimeException',
    '',
    'Message:',
    c.message || 'No message provided',
    '',
    'Stack Trace:',
    c.stackTrace || 'No stack trace captured',
    '',
    'Caused By:',
    c.causedBy || 'None',
    '',
    'Raw Crash Log:',
    c.rawLog || crashEntry?.rawText || ''
  ].join('\n');

  return sanitizeSensitiveData(report);
}

/**
 * Correlates raw and structured logs into immutable event entries.
 * HTTP transactions and Crash Diagnostics are guaranteed distinct, permanent, and isolated:
 * - In-flight requests are tracked only while pending.
 * - Responses match and complete pending in-flight requests in FIFO order.
 * - Completed transactions are finalized and never mutated by subsequent requests.
 * - Repeated calls to the same endpoint produce separate, independent records.
 * - Fatal exceptions are assembled into complete multi-line APP CRASH diagnostic events.
 */
export function correlateLogs(logs = []) {
  let activeToken = null;
  const rawParsed = logs.map((log, idx) => parseLogEntry(log, idx));

  const result = [];
  // Pending maps ONLY track in-flight requests awaiting responses
  const pendingByRequestId = new Map(); // requestId -> index in result
  const pendingByEndpoint = new Map();  // endpoint -> array of indices in result (FIFO)
  let pendingApiIdx = null; // points to the most recent transaction index expecting multi-line body

  // Crash multiline state machine
  let activeCrash = null;

  function finalizeCrashBlock(crash) {
    if (!crash) return;
    const fullStackTrace = [
      ...(crash.exceptionType ? [`${crash.exceptionType}${crash.message ? ': ' + crash.message : ''}`] : []),
      ...crash.stackFrames,
      ...(crash.causedBy ? [crash.causedBy] : [])
    ].join('\n');

    const crashEntry = {
      id: crash.id,
      index: crash.startIndex,
      time: crash.time,
      level: 'ERROR',
      category: 'APP CRASH',
      status: 'CRASH',
      duration: null,
      isExpandable: true,
      rawText: crash.rawLines.join('\n'),
      cleanText: `CRASH: ${crash.exceptionType || 'Fatal Exception'}${crash.message ? ': ' + crash.message : ''}`,
      crashDetails: {
        exceptionType: crash.exceptionType || 'java.lang.RuntimeException',
        message: crash.message || '',
        thread: crash.thread || 'main',
        process: crash.process || null,
        pid: crash.pid || null,
        stackTrace: fullStackTrace.trim() || crash.cleanLines.join('\n'),
        causedBy: crash.causedBy || null,
        rawLog: crash.rawLines.join('\n')
      }
    };
    result.push(crashEntry);

    // Also push raw entries for App Logcat stream
    if (crash.rawEntries && crash.rawEntries.length > 0) {
      for (const re of crash.rawEntries) {
        result.push({
          ...re,
          category: 'APP LOGCAT',
          isCrashContinuationLine: true
        });
      }
    }
  }

  function stripCrashPrefix(text) {
    if (!text) return '';
    return text
      .replace(/^\[\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?\]\s*/, '')
      .replace(/^\[(INFO|WARN|ERROR|DEBUG)\]\s*/, '')
      .replace(/^\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3}\s+\d+\s+\d+\s+[VDIWE]\s+/, '')
      .replace(/^(?:.*?\s+)?(?:AndroidRuntime(?:\(\s*\d+\s*\))?|E\/AndroidRuntime(?:\(\s*\d+\s*\))?):\s*/, '')
      .trim();
  }

  function isFatalExceptionStart(entry) {
    const text = entry.cleanText || '';
    const raw = entry.rawText || '';
    return text.includes('FATAL EXCEPTION') || text.includes('AndroidRuntime: FATAL') || raw.includes('FATAL EXCEPTION') || (entry.rawLog && (entry.rawLog.type === 'APP_CRASH' || entry.rawLog.category === 'APP CRASH'));
  }

  function isCrashContinuationLine(entry) {
    const clean = entry.cleanText || '';
    const raw = entry.rawText || '';

    // If starting a new crash, not a continuation
    if (isFatalExceptionStart(entry)) return false;

    // Definite non-crash log lines
    if (
      entry.category === 'API' ||
      clean.includes('[API]') ||
      clean.includes('[VOLLEY_') ||
      clean.includes('API_TO_CALL') ||
      clean.includes('ActivityTaskManager:') ||
      clean.includes('ActivityManager:') ||
      clean.includes('WindowManager:') ||
      clean.startsWith('✓') ||
      clean.startsWith('▶') ||
      clean.startsWith('ℹ')
    ) {
      return false;
    }

    // AndroidRuntime logs are part of the fatal exception crash trace
    if (raw.includes('AndroidRuntime') || clean.includes('AndroidRuntime')) {
      return true;
    }

    // Java / Android stack trace continuation patterns
    const stripped = stripCrashPrefix(clean || raw);
    if (
      stripped.startsWith('at ') ||
      stripped.startsWith('Process:') ||
      stripped.includes('PID:') ||
      stripped.startsWith('Caused by:') ||
      stripped.startsWith('Suppressed:') ||
      stripped.startsWith('...') ||
      /^[a-zA-Z_$][a-zA-Z0-9_$.]*(?:Exception|Error|Throwable)(?::.*)?$/.test(stripped)
    ) {
      return true;
    }

    return false;
  }

  function matchPendingIndex(entry) {
    const reqId = entry.apiDetails?.requestId;
    if (reqId && pendingByRequestId.has(reqId)) {
      return pendingByRequestId.get(reqId);
    }
    const ep = entry.apiDetails?.endpoint;
    if (ep && pendingByEndpoint.has(ep)) {
      const queue = pendingByEndpoint.get(ep);
      if (queue && queue.length > 0) {
        return queue[0];
      }
    }
    // Fallback: match by URL path ignoring query parameters
    if (ep) {
      const epPath = ep.split('?')[0];
      for (const [key, queue] of pendingByEndpoint.entries()) {
        if (queue && queue.length > 0 && key.split('?')[0] === epPath) {
          return queue[0];
        }
      }
    }
    return null;
  }

  function removePendingIndex(idx, entryToRemove) {
    const reqId = entryToRemove?.apiDetails?.requestId;
    if (reqId) {
      pendingByRequestId.delete(reqId);
    }
    const ep = entryToRemove?.apiDetails?.endpoint;
    if (ep && pendingByEndpoint.has(ep)) {
      const queue = pendingByEndpoint.get(ep);
      const pos = queue.indexOf(idx);
      if (pos !== -1) queue.splice(pos, 1);
      if (queue.length === 0) pendingByEndpoint.delete(ep);
    }
    // Sweep any queue referencing this index
    for (const [key, queue] of pendingByEndpoint.entries()) {
      const pos = queue.indexOf(idx);
      if (pos !== -1) {
        queue.splice(pos, 1);
        if (queue.length === 0) pendingByEndpoint.delete(key);
      }
    }
  }

  function addPendingIndex(idx, entryToAdd) {
    const reqId = entryToAdd.apiDetails?.requestId;
    if (reqId) {
      pendingByRequestId.set(reqId, idx);
    }
    const ep = entryToAdd.apiDetails?.endpoint;
    if (ep) {
      if (!pendingByEndpoint.has(ep)) {
        pendingByEndpoint.set(ep, []);
      }
      pendingByEndpoint.get(ep).push(idx);
    }
  }

  for (let i = 0; i < rawParsed.length; i++) {
    const entry = rawParsed[i];
    const cleanText = entry.cleanText;

    // Direct pre-structured APP_CRASH event
    if (entry.rawLog && (entry.rawLog.type === 'APP_CRASH' || entry.rawLog.category === 'APP CRASH' || entry.rawLog.crash)) {
      if (activeCrash) {
        finalizeCrashBlock(activeCrash);
        activeCrash = null;
      }
      const c = entry.rawLog.crash || {};
      const crashEntry = {
        id: entry.id || `crash-${result.length}`,
        index: entry.index !== undefined ? entry.index : result.length,
        time: entry.time || new Date().toLocaleTimeString(),
        level: 'ERROR',
        category: 'APP CRASH',
        status: 'CRASH',
        duration: null,
        isExpandable: true,
        rawText: entry.rawText,
        cleanText: `CRASH: ${c.exceptionType || 'Fatal Exception'}${c.message ? ': ' + c.message : ''}`,
        crashDetails: {
          exceptionType: c.exceptionType || 'java.lang.RuntimeException',
          message: c.message || '',
          thread: c.thread || 'main',
          process: c.process || null,
          pid: c.pid || null,
          stackTrace: c.stackTrace || '',
          causedBy: c.causedBy || null,
          rawLog: c.rawLog || entry.rawText
        }
      };
      result.push(crashEntry);
      continue;
    }

    // --- CRASH MULTILINE STATE MACHINE ---
    if (isFatalExceptionStart(entry)) {
      if (activeCrash) {
        finalizeCrashBlock(activeCrash);
        activeCrash = null;
      }

      const stripped = cleanText.replace(/^(?:AndroidRuntime(?:\(\s*\d+\s*\))?:\s*|E\/AndroidRuntime(?:\(\s*\d+\s*\))?:\s*)/, '').trim();
      const threadMatch = stripped.match(/FATAL EXCEPTION:\s*([^\s\r\n]+)/i);

      activeCrash = {
        id: `crash-${entry.index !== undefined ? entry.index : result.length}`,
        time: entry.time || new Date().toLocaleTimeString(),
        thread: threadMatch ? threadMatch[1] : 'main',
        process: null,
        pid: null,
        exceptionType: null,
        message: null,
        stackFrames: [],
        causedBy: null,
        rawLines: [entry.rawText],
        cleanLines: [entry.cleanText],
        startIndex: entry.index !== undefined ? entry.index : result.length,
        rawEntries: [entry]
      };
      continue;
    }

    if (activeCrash) {
      if (isCrashContinuationLine(entry)) {
        activeCrash.rawLines.push(entry.rawText);
        activeCrash.cleanLines.push(entry.cleanText);
        activeCrash.rawEntries.push(entry);

        const stripped = stripCrashPrefix(cleanText || entry.rawText);

        // 1. Process & PID
        const procMatch = stripped.match(/Process:\s*([^,\s\r\n]+)(?:,\s*PID:\s*(\d+))?/i);
        if (procMatch) {
          if (!activeCrash.process) activeCrash.process = procMatch[1];
          if (procMatch[2] && !activeCrash.pid) activeCrash.pid = procMatch[2];
        }
        const pidMatch = stripped.match(/PID:\s*(\d+)/i);
        if (pidMatch && !activeCrash.pid) {
          activeCrash.pid = pidMatch[1];
        }

        // 2. Caused by
        if (stripped.startsWith('Caused by:')) {
          activeCrash.causedBy = (activeCrash.causedBy ? activeCrash.causedBy + '\n' : '') + stripped;
        }
        // 3. Stack trace frame
        else if (stripped.startsWith('at ') || stripped.startsWith('...')) {
          if (activeCrash.causedBy) {
            activeCrash.causedBy += '\n    ' + stripped;
          } else {
            activeCrash.stackFrames.push('    ' + stripped);
          }
        }
        // 4. Exception declaration line
        else if (!activeCrash.exceptionType && !stripped.startsWith('Process:') && !stripped.includes('FATAL EXCEPTION')) {
          const excMatch = stripped.match(/^([a-zA-Z_$][a-zA-Z0-9_$.]*(?:Exception|Error|Throwable)|[a-zA-Z_$][a-zA-Z0-9_$]*(?:\.[a-zA-Z_$][a-zA-Z0-9_$]*)+)(?::\s*(.*))?$/);
          if (excMatch) {
            activeCrash.exceptionType = excMatch[1];
            activeCrash.message = excMatch[2] ? excMatch[2].trim() : '';
          }
        }
        continue;
      } else {
        // Crash block has ended! Finalize it
        finalizeCrashBlock(activeCrash);
        activeCrash = null;
      }
    }

    // 1. Track active JWT/auth tokens from logcat stream
    if (cleanText.includes('TOKEN:')) {
      const tokenMatch = cleanText.match(/TOKEN:\s*([^\s]+)/i);
      if (tokenMatch) {
        activeToken = tokenMatch[1].trim();
      }
    }

    // 2. Structured API / Volley entries
    if (entry.category === 'API' && entry.apiDetails) {
      const endpoint = entry.apiDetails.endpoint;

      // Assign unique requestId if not already present
      if (!entry.apiDetails.requestId) {
        entry.apiDetails.requestId = `req_${entry.id || ('idx_' + i)}`;
      }

      // Auto-assign request headers if active token is known
      if (activeToken && !entry.apiDetails.requestHeaders) {
        entry.apiDetails.requestHeaders = formatHeaders({
          Authorization: `Bearer ${activeToken}`,
          'Content-Type': 'application/json'
        });
      }

      const isRequest = entry.apiDetails.type === 'request';
      const isResponse = entry.apiDetails.type === 'response';
      const isFull = !!entry.apiDetails.isFullTransaction;

      if (isRequest) {
        const newIdx = result.length;
        result.push(entry);
        addPendingIndex(newIdx, entry);
        pendingApiIdx = newIdx;
      } else if (isFull) {
        const pendingIdx = matchPendingIndex(entry);
        if (pendingIdx !== null && result[pendingIdx]) {
          const existing = result[pendingIdx];
          result[pendingIdx] = {
            ...entry,
            id: existing.id,
            time: existing.time || entry.time,
            duration: entry.duration || existing.duration,
            status: entry.status || existing.status,
            apiDetails: {
              ...entry.apiDetails,
              requestId: existing.apiDetails?.requestId || entry.apiDetails.requestId,
              duration: entry.duration || existing.duration,
              status: entry.status || existing.status,
              responseSize: entry.apiDetails.responseSize || existing.apiDetails?.responseSize,
              requestHeaders: existing.apiDetails?.requestHeaders || entry.apiDetails?.requestHeaders,
              requestBody: existing.apiDetails?.requestBody || entry.apiDetails?.requestBody,
              responseHeaders: entry.apiDetails.responseHeaders || existing.apiDetails?.responseHeaders,
              responseBody: entry.apiDetails.responseBody || existing.apiDetails?.responseBody,
              type: 'completed',
              isFullTransaction: true
            }
          };
          removePendingIndex(pendingIdx, existing);
          pendingApiIdx = pendingIdx;
        } else {
          const newIdx = result.length;
          result.push(entry);
          pendingApiIdx = newIdx;
        }
      } else if (isResponse) {
        const pendingIdx = matchPendingIndex(entry);
        if (pendingIdx !== null && result[pendingIdx]) {
          const existing = result[pendingIdx];
          result[pendingIdx] = {
            ...existing,
            status: entry.status || existing.status || 200,
            duration: entry.duration || existing.duration,
            apiDetails: {
              ...existing.apiDetails,
              status: entry.status || existing.status || 200,
              statusText: entry.apiDetails.statusText || existing.apiDetails?.statusText || HTTP_STATUS_TEXTS[entry.status || 200] || 'OK',
              duration: entry.duration || existing.duration,
              responseSize: entry.apiDetails.responseSize || existing.apiDetails?.responseSize,
              requestHeaders: existing.apiDetails?.requestHeaders || (activeToken ? formatHeaders({ Authorization: `Bearer ${activeToken}`, 'Content-Type': 'application/json' }) : null),
              requestBody: existing.apiDetails?.requestBody || null,
              responseHeaders: entry.apiDetails.responseHeaders || existing.apiDetails?.responseHeaders || formatHeaders({ 'Content-Type': 'application/json; charset=utf-8' }),
              responseBody: entry.apiDetails.responseBody || existing.apiDetails?.responseBody,
              type: 'completed'
            }
          };
          removePendingIndex(pendingIdx, existing);
          pendingApiIdx = pendingIdx;
        } else if (pendingApiIdx !== null && result[pendingApiIdx] && result[pendingApiIdx].apiDetails?.endpoint === endpoint) {
          const lastTx = result[pendingApiIdx];
          if (!lastTx.duration && entry.duration) {
            lastTx.duration = entry.duration;
            lastTx.apiDetails.duration = entry.duration;
          }
          if (!lastTx.apiDetails.responseSize && entry.apiDetails?.responseSize) {
            lastTx.apiDetails.responseSize = entry.apiDetails.responseSize;
          }
        } else {
          if (!entry.apiDetails.responseHeaders) {
            entry.apiDetails.responseHeaders = formatHeaders({ 'Content-Type': 'application/json; charset=utf-8' });
          }
          const newIdx = result.length;
          result.push(entry);
          pendingApiIdx = newIdx;
        }
      } else {
        const newIdx = result.length;
        result.push(entry);
        pendingApiIdx = newIdx;
      }
    }
    // 3. Multi-line request or response JSON payloads
    else {
      let jsonCandidate = null;
      const jStart = cleanText.indexOf('{');
      const jEnd = cleanText.lastIndexOf('}');
      if (jStart !== -1 && jEnd !== -1 && jEnd > jStart) {
        jsonCandidate = cleanText.substring(jStart, jEnd + 1);
      } else if (cleanText.startsWith('[') && cleanText.endsWith(']')) {
        jsonCandidate = cleanText;
      }

      let isCorrelatedPayload = false;
      if (jsonCandidate && pendingApiIdx !== null && result[pendingApiIdx]) {
        try {
          JSON.parse(jsonCandidate); // validate JSON syntax
          const targetEntry = result[pendingApiIdx];

          if (
            cleanText.includes('Response:') ||
            cleanText.includes('onResponse:') ||
            cleanText.includes('PhotoMultipartRequest') ||
            cleanText.includes('GsonRequest') ||
            (targetEntry.apiDetails?.requestBody && !targetEntry.apiDetails?.responseBody)
          ) {
            targetEntry.apiDetails.responseBody = formatPayloadBody(jsonCandidate);
            if (!targetEntry.apiDetails.responseHeaders) {
              targetEntry.apiDetails.responseHeaders = formatHeaders({ 'Content-Type': 'application/json; charset=utf-8' });
            }
            isCorrelatedPayload = true;
          }
          else if (!targetEntry.apiDetails?.requestBody && (targetEntry.apiDetails?.type === 'request' || cleanText.includes('Helper') || cleanText.includes('callApiFor'))) {
            targetEntry.apiDetails.requestBody = formatPayloadBody(jsonCandidate);
            if (!targetEntry.apiDetails.requestHeaders && activeToken) {
              targetEntry.apiDetails.requestHeaders = formatHeaders({
                Authorization: `Bearer ${activeToken}`,
                'Content-Type': 'application/json'
              });
            }
            isCorrelatedPayload = true;
          }
        } catch (e) {}
      }

      // Only append to display list if not already merged into API transaction
      if (!isCorrelatedPayload && !cleanText.includes('TOKEN:')) {
        result.push(entry);
      }
    }
  }

  // Finalize any trailing crash block at the end of the log stream
  if (activeCrash) {
    finalizeCrashBlock(activeCrash);
    activeCrash = null;
  }

  return result;
}

/**
 * Postman-Style Syntax Highlighted JSON Viewer Component
 */
export function JsonSyntaxViewer({ json, maxHeightClass = 'max-h-[480px]', showLineNumbers = true }) {
  if (!json && json !== false && json !== 0) {
    return <div className="text-slate-500 italic text-[11px] p-2">Empty payload</div>;
  }

  const formattedJson = useMemo(() => {
    let str = '';
    if (typeof json === 'object') {
      str = JSON.stringify(json, null, 2);
    } else if (typeof json === 'string') {
      const trimmed = json.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed);
          str = JSON.stringify(parsed, null, 2);
        } catch (e) {
          str = json;
        }
      } else {
        str = json;
      }
    } else {
      str = String(json);
    }
    return sanitizeSensitiveData(str);
  }, [json]);

  const lines = useMemo(() => {
    return (formattedJson || '').split('\n');
  }, [formattedJson]);

  return (
    <div className={`bg-[#07090E] rounded border border-[#171E2E] overflow-x-hidden overflow-y-auto ${maxHeightClass} select-text font-mono text-[12px] leading-relaxed p-2.5`}>
      <table className="w-full table-fixed border-collapse">
        {showLineNumbers && (
          <colgroup>
            <col className="w-9" />
            <col className="w-auto" />
          </colgroup>
        )}
        <tbody>
          {lines.map((line, lineIdx) => {
            const tokens = tokenizeJsonLine(line);

            return (
              <tr key={lineIdx} className="hover:bg-[#131924]/40 transition-colors">
                {showLineNumbers && (
                  <td className="w-9 pr-3 text-right select-none text-slate-600 text-[11px] font-mono border-r border-[#1E2638]/60 align-top shrink-0">
                    {lineIdx + 1}
                  </td>
                )}
                <td className={`${showLineNumbers ? 'pl-3' : 'pl-1'} whitespace-pre-wrap break-words [overflow-wrap:anywhere] font-mono text-[12px] align-top`}>
                  {tokens.map((token, tIdx) => {
                    let colorClass = 'text-[#C9D1D9]'; // Light gray for brackets, braces, commas
                    if (token.type === 'key') colorClass = 'text-[#79C0FF] font-medium'; // Light blue
                    else if (token.type === 'string') colorClass = 'text-[#A5D6A7]'; // Light green
                    else if (token.type === 'number') colorClass = 'text-[#FFB86C]'; // Orange
                    else if (token.type === 'boolean') colorClass = 'text-[#C792EA] font-semibold'; // Purple
                    else if (token.type === 'null') colorClass = 'text-[#F07178] italic font-semibold'; // Muted red
                    else if (token.type === 'punctuation') colorClass = 'text-[#C9D1D9]';
                    else if (token.type === 'text') colorClass = 'text-slate-400';

                    return (
                      <span key={tIdx} className={colorClass}>
                        {token.text}
                      </span>
                    );
                  })}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function LiveLogViewer({ logs = [], onClear, testId }) {
  const [filter, setFilter] = useState('');
  const [activeTab, setActiveTab] = useState('ALL'); // 'ALL' | 'API' | 'LOGCAT' | 'ACTION' | 'ERROR'
  const [viewMode, setViewMode] = useState('structured'); // 'structured' | 'raw'
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [copiedRowId, setCopiedRowId] = useState(null);
  const [apiViewModes, setApiViewModes] = useState({}); // rowId -> 'inspector' | 'json'
  const [isMaximized, setIsMaximized] = useState(false);
  const logContainerRef = useRef(null);

  // Keyboard shortcut: ESC to close expanded console overlay
  useEffect(() => {
    if (!isMaximized) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' || e.keyCode === 27) {
        e.preventDefault();
        setIsMaximized(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMaximized]);

  // Lock body scrolling when console is expanded to prevent background page movement
  useEffect(() => {
    if (!isMaximized) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isMaximized]);

  // Parse, normalize, and correlate all log entries into immutable transaction history
  const parsedLogs = useMemo(() => {
    return correlateLogs(logs);
  }, [logs]);

  // Counts by category
  const categoryCounts = useMemo(() => {
    const counts = { ALL: 0, API: 0, LOGCAT: 0, ACTION: 0, ERROR: 0, CRASH: 0 };
    parsedLogs.forEach(entry => {
      // Continuation lines belong only to the full raw App Logcat view
      if (entry.isCrashContinuationLine) {
        counts.LOGCAT++;
        return;
      }
      counts.ALL++;
      if (entry.category === 'API') counts.API++;
      else if (entry.category === 'QA ACTION') counts.ACTION++;
      else if (entry.category === 'APP CRASH') counts.CRASH++;
      else if (entry.category === 'ERROR') counts.ERROR++;
      else counts.LOGCAT++;
    });
    return counts;
  }, [parsedLogs]);

  // Filtered entries according to active tab and search query
  const displayedLogs = useMemo(() => {
    return parsedLogs.filter(entry => {
      // Continuation lines only appear in App Logcat tab
      if (entry.isCrashContinuationLine && activeTab !== 'LOGCAT') {
        return false;
      }

      // Tab filter
      if (activeTab === 'API' && entry.category !== 'API') return false;
      if (activeTab === 'ACTION' && entry.category !== 'QA ACTION') return false;
      if (activeTab === 'ERROR' && entry.category !== 'ERROR') return false;
      if (activeTab === 'CRASH' && entry.category !== 'APP CRASH') return false;
      if (activeTab === 'LOGCAT' && entry.category !== 'APP LOGCAT') return false;

      // Text search filter
      if (!filter) return true;
      const searchLower = filter.toLowerCase();
      return (
        entry.rawText.toLowerCase().includes(searchLower) ||
        entry.cleanText.toLowerCase().includes(searchLower) ||
        (entry.crashDetails?.exceptionType && entry.crashDetails.exceptionType.toLowerCase().includes(searchLower)) ||
        (entry.crashDetails?.message && entry.crashDetails.message.toLowerCase().includes(searchLower)) ||
        (entry.crashDetails?.stackTrace && entry.crashDetails.stackTrace.toLowerCase().includes(searchLower)) ||
        (entry.apiDetails?.endpoint && entry.apiDetails.endpoint.toLowerCase().includes(searchLower)) ||
        (entry.apiDetails?.method && entry.apiDetails.method.toLowerCase().includes(searchLower)) ||
        (entry.apiDetails?.requestBody?.text && entry.apiDetails.requestBody.text.toLowerCase().includes(searchLower)) ||
        (entry.apiDetails?.responseBody?.text && entry.apiDetails.responseBody.text.toLowerCase().includes(searchLower))
      );
    });
  }, [parsedLogs, activeTab, filter]);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [displayedLogs, autoScroll]);

  const toggleExpand = (id) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleCopyAll = () => {
    const sanitizedText = parsedLogs.map(l => l.rawText).join('\n');
    navigator.clipboard.writeText(sanitizedText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyRowDetails = (entry) => {
    const currentMode = apiViewModes[entry.id] || 'inspector';
    let reportText = '';
    if (entry.category === 'APP CRASH') {
      reportText = formatCrashReport(entry);
    } else if (entry.apiDetails) {
      if (currentMode === 'json') {
        const transactionObj = getStructuredTransactionJson(entry);
        reportText = JSON.stringify(transactionObj, null, 2);
      } else {
        const api = entry.apiDetails;
        const queryParamsFormatted = api.queryParams && api.queryParams.length > 0
          ? api.queryParams.map(q => `  ${q.key}: ${q.value}`).join('\n')
          : 'None';

        reportText = [
          'API Request',
          `${api.method || 'GET'} ${api.endpoint || 'Unknown URL'}`,
          '',
          `Status: ${api.status || entry.status || 200} ${api.statusText || HTTP_STATUS_TEXTS[api.status || entry.status || 200] || 'OK'}`,
          `Duration: ${api.duration || entry.duration || 'Not captured'}`,
          `Response Size: ${api.responseSize || 'Not captured'}`,
          '',
          'Request Headers:',
          api.requestHeaders || 'Not captured',
          '',
          'Query Parameters:',
          queryParamsFormatted,
          '',
          'Request Body:',
          api.requestBody?.text || 'Not captured',
          '',
          'Response Headers:',
          api.responseHeaders || 'Not captured',
          '',
          'Response Body:',
          api.responseBody?.text || 'Not captured'
        ].join('\n');
      }
    } else {
      reportText = JSON.stringify({
        category: entry.category,
        time: entry.time,
        level: entry.level,
        message: entry.cleanText,
        raw: entry.rawText
      }, null, 2);
    }

    navigator.clipboard.writeText(sanitizeSensitiveData(reportText));
    setCopiedRowId(entry.id);
    setTimeout(() => setCopiedRowId(null), 2000);
  };

  const handleDownload = () => {
    const lines = [];
    lines.push(`================================================================`);
    lines.push(`PAD TEST EXECUTION & HTTP TRANSACTION LOG - ${testId || 'LIVE'}`);
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push(`================================================================\n`);

    for (const entry of parsedLogs) {
      if (entry.isCrashContinuationLine) continue; // Do not duplicate in summary stream
      if (entry.category === 'APP CRASH') {
        lines.push(formatCrashReport(entry));
        lines.push('----------------------------------------------------------------\n');
      } else if (entry.category === 'API' && entry.apiDetails) {
        const api = entry.apiDetails;
        lines.push(`[API] [${entry.time || 'N/A'}]`);
        lines.push(`${api.method || 'GET'} ${api.endpoint}`);
        lines.push(`Status: ${api.status || entry.status || 200} ${api.statusText || 'OK'} | Duration: ${api.duration || 'N/A'} | Size: ${api.responseSize || 'N/A'}`);
        if (api.requestHeaders) lines.push(`Request Headers:\n${api.requestHeaders}`);
        if (api.queryParams && api.queryParams.length > 0) {
          lines.push(`Query Parameters:\n${api.queryParams.map(q => `  ${q.key}=${q.value}`).join('\n')}`);
        }
        if (api.requestBody?.text) lines.push(`Request Body:\n${api.requestBody.text}`);
        if (api.responseHeaders) lines.push(`Response Headers:\n${api.responseHeaders}`);
        if (api.responseBody?.text) lines.push(`Response Body:\n${api.responseBody.text}`);
        lines.push('----------------------------------------------------------------\n');
      } else {
        lines.push(`[${entry.time || ''}] [${entry.level}] [${entry.category}] ${entry.cleanText}`);
      }
    }

    const sanitizedText = sanitizeSensitiveData(lines.join('\n'));
    const blob = new Blob([sanitizedText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pad-execution-log-${testId || 'stream'}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const getMethodBadgeClass = (method) => {
    switch (method?.toUpperCase()) {
      case 'GET': return 'bg-sky-950/70 text-sky-400 border-sky-800/70';
      case 'POST': return 'bg-emerald-950/70 text-emerald-400 border-emerald-800/70';
      case 'PUT': return 'bg-amber-950/70 text-amber-400 border-amber-800/70';
      case 'DELETE': return 'bg-rose-950/70 text-rose-400 border-rose-800/70';
      case 'PATCH': return 'bg-purple-950/70 text-purple-400 border-purple-800/70';
      default: return 'bg-slate-800 text-slate-300 border-slate-700';
    }
  };

  const getStatusBadge = (status, statusText) => {
    if (!status) return null;
    const num = parseInt(status, 10);
    const text = statusText || HTTP_STATUS_TEXTS[num] || '';
    if (!isNaN(num)) {
      if (num >= 200 && num < 300) {
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-mono px-1.5 py-0.5 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-800/60 font-semibold">
            ✓ {num} {text && <span className="text-[10px] opacity-80">{text}</span>}
          </span>
        );
      }
      if (num >= 300 && num < 400) {
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-mono px-1.5 py-0.5 rounded bg-sky-950/60 text-sky-400 border border-sky-800/60 font-semibold">
            ↪ {num} {text && <span className="text-[10px] opacity-80">{text}</span>}
          </span>
        );
      }
      if (num >= 400 && num < 500) {
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-mono px-1.5 py-0.5 rounded bg-amber-950/60 text-amber-400 border border-amber-800/60 font-semibold">
            ⚠ {num} {text && <span className="text-[10px] opacity-80">{text}</span>}
          </span>
        );
      }
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-mono px-1.5 py-0.5 rounded bg-rose-950/60 text-rose-400 border border-rose-800/60 font-semibold">
          ✕ {num} {text && <span className="text-[10px] opacity-80">{text}</span>}
        </span>
      );
    }
    return <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">{status}</span>;
  };

  const getCategoryBadge = (category) => {
    switch (category) {
      case 'API':
        return <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-indigo-950/60 text-indigo-300 border border-indigo-800/50">API</span>;
      case 'QA ACTION':
        return <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-950/60 text-emerald-300 border border-emerald-800/50">QA ACTION</span>;
      case 'APP CRASH':
        return (
          <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-rose-950/90 text-rose-300 border border-rose-600/70 shadow-xs flex items-center gap-1">
            <Flame className="w-2.5 h-2.5 text-rose-400" />
            APP CRASH
          </span>
        );
      case 'ERROR':
        return <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-rose-950/60 text-rose-300 border border-rose-800/50">ERROR</span>;
      default:
        return <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">LOGCAT</span>;
    }
  };

  const getRawLogColorClass = (level, text) => {
    if (level === 'ERROR' || text.toLowerCase().includes('failed') || text.toLowerCase().includes('error')) {
      return 'text-rose-400 bg-rose-950/20';
    }
    if (level === 'WARN' || text.toLowerCase().includes('warn')) {
      return 'text-amber-400';
    }
    if (text.includes('✓') || text.includes('PASS') || text.includes('completed') || text.includes('100%')) {
      return 'text-emerald-400 font-semibold';
    }
    if (level === 'DEBUG') {
      return 'text-slate-400';
    }
    return 'text-slate-200';
  };

  const consoleInnerContent = (
    <>
      {/* Console Header Bar */}
      <div className="px-4 py-2.5 bg-[#0D111A] border-b border-[#1E2638] flex flex-wrap items-center justify-between gap-3 shrink-0">
        {/* Title & Live Status */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="p-1 rounded-md bg-[#261D10] border border-[#78350F]">
              <Terminal className="w-3.5 h-3.5 text-[#F59E0B]" />
            </div>
            <span className="text-xs font-semibold text-white tracking-wide">Live Execution Console & HTTP Inspector</span>
          </div>

          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-950/40 border border-emerald-800/40">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">LIVE</span>
          </div>

          <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-[#131924] border border-[#1E2638] text-slate-400">
            {displayedLogs.length} / {parsedLogs.length} events
          </span>
        </div>

        {/* View Mode & Global Actions */}
        <div className="flex items-center gap-2">
          {/* View Mode Toggle */}
          <div className="flex items-center bg-[#131924] p-0.5 rounded-lg border border-[#1E2638]">
            <button
              onClick={() => setViewMode('structured')}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors flex items-center gap-1.5 ${
                viewMode === 'structured'
                  ? 'bg-[#1E2638] text-[#F59E0B] shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Layers className="w-3 h-3" />
              Structured
            </button>
            <button
              onClick={() => setViewMode('raw')}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors flex items-center gap-1.5 ${
                viewMode === 'raw'
                  ? 'bg-[#1E2638] text-[#F59E0B] shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Code2 className="w-3 h-3" />
              Raw Logcat
            </button>
          </div>

          {/* Auto Scroll */}
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`px-2 py-1 rounded text-xs transition-colors flex items-center gap-1 ${
              autoScroll ? 'bg-[#261D10] text-[#F59E0B] border border-[#78350F]' : 'bg-[#131924] border border-[#1E2638] text-slate-400'
            }`}
            title="Toggle Auto Scroll"
          >
            <ArrowDown className="w-3 h-3" />
            <span className="text-[11px]">Auto</span>
          </button>

          {/* Copy All */}
          <button
            onClick={handleCopyAll}
            className="p-1.5 rounded bg-[#131924] border border-[#1E2638] hover:bg-[#1E2638] text-slate-300 hover:text-white transition-colors"
            title="Copy Sanitized Logs"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>

          {/* Download */}
          <button
            onClick={handleDownload}
            className="p-1.5 rounded bg-[#131924] border border-[#1E2638] hover:bg-[#1E2638] text-slate-300 hover:text-white transition-colors"
            title="Download Execution Log"
          >
            <Download className="w-3.5 h-3.5" />
          </button>

          {/* Clear */}
          {onClear && (
            <button
              onClick={onClear}
              className="p-1.5 rounded bg-[#131924] border border-[#1E2638] hover:bg-rose-500/20 hover:text-rose-400 text-slate-300 transition-colors"
              title="Clear Console"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Divider */}
          <div className="h-4 w-px bg-[#1E2638] mx-0.5" />

          {/* Expand / Maximize Toggle Button */}
          <button
            onClick={() => setIsMaximized(!isMaximized)}
            className={`p-1.5 rounded border transition-colors flex items-center justify-center ${
              isMaximized
                ? 'bg-[#261D10] text-[#F59E0B] border-[#78350F]'
                : 'bg-[#131924] border-[#1E2638] text-slate-300 hover:text-white hover:bg-[#1E2638]'
            }`}
            title={isMaximized ? "Close Expanded Console" : "Expand Console"}
            aria-label={isMaximized ? "Close Expanded Live Execution Console" : "Expand Live Execution Console"}
          >
            {isMaximized ? (
              <Minimize2 className="w-3.5 h-3.5" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" />
            )}
          </button>

          {/* Dedicated Close Button in Expanded Mode */}
          {isMaximized && (
            <button
              onClick={() => setIsMaximized(false)}
              className="p-1.5 rounded bg-[#131924] border border-[#1E2638] hover:bg-rose-500/20 hover:text-rose-400 text-slate-300 transition-colors flex items-center justify-center"
              title="Close Expanded Console"
              aria-label="Close Expanded Live Execution Console"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Secondary Bar: Category Filter Tabs & Search */}
      <div className="px-4 py-2 bg-[#090C12] border-b border-[#1E2638] flex flex-wrap items-center justify-between gap-3 shrink-0">
        {/* Category Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
          {[
            { key: 'ALL', label: 'All', count: categoryCounts.ALL },
            { key: 'API', label: 'API Calls', count: categoryCounts.API, icon: Globe },
            { key: 'ACTION', label: 'QA Actions', count: categoryCounts.ACTION, icon: Activity },
            { key: 'ERROR', label: 'Errors', count: categoryCounts.ERROR, icon: AlertCircle },
            { key: 'CRASH', label: 'App Crashes', count: categoryCounts.CRASH, icon: Flame },
            { key: 'LOGCAT', label: 'App Logcat', count: categoryCounts.LOGCAT, icon: FileText }
          ].map(tab => {
            const isActive = activeTab === tab.key;
            const Icon = tab.icon;
            const isCrashTab = tab.key === 'CRASH';
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all flex items-center gap-1.5 border ${
                  isActive
                    ? isCrashTab
                      ? 'bg-rose-950/80 border-rose-500 text-white'
                      : 'bg-[#1E2638] border-[#3B82F6] text-white'
                    : isCrashTab && tab.count > 0
                    ? 'bg-rose-950/20 border-rose-900/50 text-rose-300 hover:text-white hover:bg-rose-950/40'
                    : 'bg-[#131924]/60 border-[#1E2638] text-slate-400 hover:text-slate-200 hover:bg-[#131924]'
                }`}
              >
                {Icon && (
                  <Icon className={`w-3 h-3 ${
                    isActive
                      ? isCrashTab ? 'text-rose-400' : 'text-[#3B82F6]'
                      : isCrashTab && tab.count > 0
                      ? 'text-rose-400'
                      : 'text-slate-500'
                  }`} />
                )}
                <span>{tab.label}</span>
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                  isActive
                    ? isCrashTab ? 'bg-rose-500/30 text-rose-200' : 'bg-[#3B82F6]/20 text-[#3B82F6]'
                    : isCrashTab && tab.count > 0
                    ? 'bg-rose-900/60 text-rose-300'
                    : 'bg-black/40 text-slate-500'
                }`}>
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Search Filter Input */}
        <div className="relative">
          <Search className="w-3 h-3 text-slate-400 absolute left-2.5 top-2.5" />
          <input
            type="text"
            placeholder="Search events, APIs, payloads..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="pl-8 pr-7 py-1 rounded-md bg-[#0A0D14] border border-[#1E2638] text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#F59E0B] w-64 transition-colors"
          />
          {filter && (
            <button
              onClick={() => setFilter('')}
              className="absolute right-2 top-2 text-slate-400 hover:text-white"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Main Console Body */}
      <div
        ref={logContainerRef}
        className="flex-1 p-3 font-mono text-[12px] leading-relaxed overflow-y-auto space-y-1 select-text bg-[#0A0D14]"
      >
        {displayedLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Terminal className="w-8 h-8 text-slate-600 mb-2" />
            <p className="text-xs text-slate-400 font-medium">No execution events found</p>
            <p className="text-[11px] text-slate-600 mt-1 max-w-sm">
              {filter ? `No events matching "${filter}"` : 'Logs and API events will appear here in real-time as PAD tests run.'}
            </p>
          </div>
        ) : viewMode === 'raw' ? (
          /* RAW LOGCAT VIEW */
          displayedLogs.map((entry) => (
            <div
              key={entry.id}
              className={`py-0.5 px-2 rounded hover:bg-[#131924]/80 transition-colors flex items-start gap-2 ${getRawLogColorClass(entry.level, entry.cleanText)}`}
            >
              {entry.time && <span className="text-slate-500 shrink-0 select-none">[{entry.time}]</span>}
              <span className="break-all whitespace-pre-wrap">{entry.cleanText}</span>
            </div>
          ))
        ) : (
          /* STRUCTURED QA VIEW */
          displayedLogs.map((entry) => {
            const isRowExpanded = expandedRows.has(entry.id);
            const isApi = entry.category === 'API';
            const isAction = entry.category === 'QA ACTION';
            const isCrash = entry.category === 'APP CRASH';
            const isError = entry.category === 'ERROR';

            return (
              <div
                key={entry.id}
                className={`border rounded-lg transition-all overflow-hidden ${
                  isCrash
                    ? 'bg-rose-950/20 border-rose-700/60 hover:border-rose-500 shadow-xs'
                    : isRowExpanded
                    ? 'bg-[#0E131F] border-[#2A3752]'
                    : isError
                    ? 'bg-rose-950/10 border-rose-900/30 hover:border-rose-700/50'
                    : isApi
                    ? 'bg-[#0B101B]/80 border-[#1B2438] hover:border-[#2D3C5C]'
                    : 'bg-[#0D111A]/60 border-[#182030] hover:border-[#232D42]'
                }`}
              >
                {/* Event Row Summary (Collapsed mode) */}
                <div
                  onClick={() => entry.isExpandable && toggleExpand(entry.id)}
                  className={`p-2 flex items-center justify-between gap-2.5 ${
                    entry.isExpandable ? 'cursor-pointer select-none' : ''
                  }`}
                >
                  {/* Left segment: Expand icon + Time + Category + Method + Summary */}
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {/* Expand icon */}
                    <div className="w-4 h-4 flex items-center justify-center shrink-0 text-slate-500">
                      {entry.isExpandable ? (
                        isRowExpanded ? (
                          <ChevronDown className={`w-3.5 h-3.5 ${isCrash ? 'text-rose-400' : 'text-[#F59E0B]'}`} />
                        ) : (
                          <ChevronRight className={`w-3.5 h-3.5 ${isCrash ? 'text-rose-400' : 'text-slate-400 group-hover:text-white'}`} />
                        )
                      ) : (
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-700" />
                      )}
                    </div>

                    {/* Timestamp */}
                    {entry.time && (
                      <span className="text-[11px] text-slate-400 shrink-0 font-mono">
                        {entry.time}
                      </span>
                    )}

                    {/* Category badge */}
                    <div className="shrink-0">{getCategoryBadge(entry.category)}</div>

                    {/* API HTTP Method badge */}
                    {isApi && entry.apiDetails?.method && (
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border shrink-0 ${getMethodBadgeClass(entry.apiDetails.method)}`}>
                        {entry.apiDetails.method}
                      </span>
                    )}

                    {/* Primary text / Endpoint / Action / Crash */}
                    <div className="truncate text-xs font-mono min-w-0">
                      {isCrash ? (
                        <div className="flex items-center gap-2 truncate">
                          <span className="text-rose-300 font-bold truncate">
                            {entry.crashDetails?.exceptionType
                              ? `${entry.crashDetails.exceptionType}${entry.crashDetails.message ? ': ' + entry.crashDetails.message : ''}`
                              : entry.cleanText}
                          </span>
                          {entry.crashDetails?.thread && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-rose-950/60 text-rose-400 border border-rose-800/50 shrink-0">
                              thread: {entry.crashDetails.thread}
                            </span>
                          )}
                        </div>
                      ) : isApi && entry.apiDetails?.endpoint ? (
                        <span className="text-white font-medium hover:underline">
                          {entry.apiDetails.endpoint}
                        </span>
                      ) : isAction ? (
                        <span className="text-emerald-300">{entry.cleanText}</span>
                      ) : isError ? (
                        <span className="text-rose-300 font-semibold">{entry.cleanText}</span>
                      ) : (
                        <span className="text-slate-300">{entry.cleanText}</span>
                      )}
                    </div>
                  </div>

                  {/* Right segment: Status badge + Duration + Response Size */}
                  <div className="flex items-center gap-2 shrink-0">
                    {isCrash ? (
                      <div className="flex items-center gap-1.5">
                        {entry.crashDetails?.pid && (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#131924] text-slate-400 border border-[#1E2638]">
                            PID: {entry.crashDetails.pid}
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1 text-[11px] font-mono px-1.5 py-0.5 rounded bg-rose-950/80 text-rose-300 border border-rose-600/70 font-bold">
                          ✕ FATAL
                        </span>
                      </div>
                    ) : isApi ? (
                      getStatusBadge(entry.status, entry.apiDetails?.statusText)
                    ) : (
                      getStatusBadge(entry.status)
                    )}

                    {entry.duration && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-slate-400 bg-[#131924] px-1.5 py-0.5 rounded border border-[#1E2638] font-mono">
                        <Clock className="w-2.5 h-2.5 text-slate-500" />
                        {entry.duration}
                      </span>
                    )}

                    {isApi && entry.apiDetails?.responseSize && (
                      <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-slate-400 bg-[#131924] px-1.5 py-0.5 rounded border border-[#1E2638] font-mono">
                        <HardDrive className="w-2.5 h-2.5 text-slate-500" />
                        {entry.apiDetails.responseSize}
                      </span>
                    )}
                  </div>
                </div>

                {/* Inline Expanded QA Inspector Panel */}
                {isRowExpanded && (() => {
                  const currentMode = apiViewModes[entry.id] || 'inspector';

                  return (
                    <div className="border-t border-[#1E2638] bg-[#07090E] p-3 space-y-3 font-mono text-xs">
                      {/* Header bar with Inspector/JSON Toggle & Copy Details button */}
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#171E2E] pb-2">
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-2 text-slate-400 text-[11px]">
                            {isCrash ? (
                              <>
                                <Flame className="w-3.5 h-3.5 text-rose-500" />
                                <span className="font-semibold text-rose-300">
                                  Android Crash Diagnostics & Stack Trace
                                </span>
                              </>
                            ) : (
                              <>
                                <Code2 className="w-3.5 h-3.5 text-[#F59E0B]" />
                                <span className="font-semibold text-slate-300">
                                  {isApi ? 'Full HTTP Request & Response Inspector' : isAction ? 'QA Action Execution Details' : isError ? 'Error Diagnostics' : 'Log Details'}
                                </span>
                              </>
                            )}
                          </div>

                          {/* Segmented Toggle for API Inspector: Inspector | JSON */}
                          {isApi && (
                            <div className="inline-flex items-center bg-[#0D121F] border border-[#1E2638] rounded-md p-0.5" role="tablist" aria-label="Inspector View Mode">
                              <button
                                role="tab"
                                aria-selected={currentMode === 'inspector'}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setApiViewModes(prev => ({ ...prev, [entry.id]: 'inspector' }));
                                }}
                                className={`px-2.5 py-0.5 rounded text-[10px] font-medium transition-all ${
                                  currentMode === 'inspector'
                                    ? 'bg-[#1E2638] text-white font-semibold shadow-sm'
                                    : 'text-slate-400 hover:text-slate-200'
                                }`}
                              >
                                Inspector
                              </button>
                              <button
                                role="tab"
                                aria-selected={currentMode === 'json'}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setApiViewModes(prev => ({ ...prev, [entry.id]: 'json' }));
                                }}
                                className={`px-2.5 py-0.5 rounded text-[10px] font-medium transition-all flex items-center gap-1 ${
                                  currentMode === 'json'
                                    ? 'bg-[#1E2638] text-sky-400 font-semibold shadow-sm'
                                    : 'text-slate-400 hover:text-slate-200'
                                }`}
                              >
                                <Code2 className="w-2.5 h-2.5" />
                                JSON
                              </button>
                            </div>
                          )}
                        </div>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCopyRowDetails(entry);
                          }}
                          className="px-2.5 py-1 rounded bg-[#131924] border border-[#1E2638] hover:bg-[#1E2638] text-slate-300 hover:text-white transition-colors flex items-center gap-1 text-[11px]"
                        >
                          {copiedRowId === entry.id ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-400" />
                              <span className="text-emerald-400">
                                {isCrash ? 'Copied Crash Report' : currentMode === 'json' ? 'Copied JSON' : 'Copied Report'}
                              </span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              <span>
                                {isCrash ? 'Copy Crash Details' : currentMode === 'json' ? 'Copy JSON' : 'Copy Details'}
                              </span>
                            </>
                          )}
                        </button>
                      </div>

                      {/* 1. JSON VIEW MODE */}
                      {isApi && currentMode === 'json' && (
                        <div className="bg-[#0B0E17] border border-[#1C253B] rounded-lg p-3 space-y-2">
                          <div className="flex items-center justify-between text-[11px] text-slate-400 border-b border-[#1C253B] pb-1.5">
                            <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                              <Code2 className="w-3 h-3 text-sky-400" />
                              Formatted HTTP Transaction (JSON)
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono">
                              {entry.apiDetails?.method || 'GET'} {entry.apiDetails?.endpoint}
                            </span>
                          </div>
                          <JsonSyntaxViewer
                            json={getStructuredTransactionJson(entry)}
                            maxHeightClass={isMaximized ? 'max-h-[calc(85vh-280px)] min-h-[300px]' : 'max-h-[480px]'}
                            showLineNumbers={true}
                          />
                        </div>
                      )}

                      {/* 2. DUAL-COLUMN INSPECTOR VIEW MODE */}
                      {isApi && currentMode === 'inspector' && (
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                          {/* LEFT COLUMN: REQUEST INSPECTION */}
                          <div className="bg-[#0B0E17] border border-[#1C253B] rounded-lg p-3 space-y-2.5">
                            <div className="flex items-center justify-between border-b border-[#1C253B] pb-1.5">
                              <div className="flex items-center gap-1.5 text-xs font-semibold text-sky-400">
                                <Send className="w-3.5 h-3.5" />
                                <span>REQUEST</span>
                              </div>
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${getMethodBadgeClass(entry.apiDetails?.method || 'GET')}`}>
                                {entry.apiDetails?.method || 'GET'}
                              </span>
                            </div>

                            {/* Full URL */}
                            <div>
                              <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-1">Full URL</div>
                              <div className="bg-[#07090E] p-2 rounded border border-[#171E2E] text-sky-300 text-[11px] break-all select-all font-mono">
                                {entry.apiDetails?.endpoint || 'Not captured'}
                              </div>
                            </div>

                            {/* Query Parameters */}
                            <div>
                              <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-1">Query Parameters</div>
                              {entry.apiDetails?.queryParams && entry.apiDetails.queryParams.length > 0 ? (
                                <div className="bg-[#07090E] rounded border border-[#171E2E] overflow-hidden">
                                  <table className="w-full text-left text-[11px]">
                                    <thead className="bg-[#0D121F] border-b border-[#171E2E] text-[10px] text-slate-400">
                                      <tr>
                                        <th className="px-2 py-1 font-medium">Param</th>
                                        <th className="px-2 py-1 font-medium">Value</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#171E2E]">
                                      {entry.apiDetails.queryParams.map((param, qIdx) => (
                                        <tr key={qIdx} className="hover:bg-[#131926]/50">
                                          <td className="px-2 py-1 text-slate-300 font-mono select-all">{param.key}</td>
                                          <td className="px-2 py-1 text-emerald-400 font-mono select-all">{param.value}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              ) : (
                                <div className="bg-[#07090E] p-2 rounded border border-[#171E2E] text-slate-500 text-[11px] italic">
                                  {entry.apiDetails?.endpoint?.includes('?') ? 'Not captured' : 'None'}
                                </div>
                              )}
                            </div>

                            {/* Request Headers */}
                            <div>
                              <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-1">Request Headers</div>
                              {entry.apiDetails?.requestHeaders ? (
                                <pre className={`bg-[#07090E] p-2 rounded border border-[#171E2E] text-slate-300 text-[11px] overflow-x-auto whitespace-pre-wrap font-mono ${isMaximized ? 'max-h-60' : 'max-h-36'}`}>
                                  {entry.apiDetails.requestHeaders}
                                </pre>
                              ) : (
                                <div className="bg-[#07090E] p-2 rounded border border-[#171E2E] text-slate-500 text-[11px] italic">
                                  Not captured
                                </div>
                              )}
                            </div>

                            {/* Request Body */}
                            <div>
                              <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-1">Request Body</div>
                              {entry.apiDetails?.requestBody?.text ? (
                                entry.apiDetails.requestBody.isJson ? (
                                  <JsonSyntaxViewer
                                    json={entry.apiDetails.requestBody.text}
                                    maxHeightClass={isMaximized ? 'max-h-96' : 'max-h-48'}
                                    showLineNumbers={true}
                                  />
                                ) : (
                                  <pre className={`bg-[#07090E] p-2 rounded border border-[#171E2E] text-emerald-300 text-[11px] overflow-x-auto whitespace-pre-wrap font-mono ${isMaximized ? 'max-h-96' : 'max-h-48'}`}>
                                    {entry.apiDetails.requestBody.text}
                                  </pre>
                                )
                              ) : (
                                <div className="bg-[#07090E] p-2 rounded border border-[#171E2E] text-slate-500 text-[11px] italic">
                                  Not captured
                                </div>
                              )}
                            </div>
                          </div>

                          {/* RIGHT COLUMN: RESPONSE INSPECTION */}
                          <div className="bg-[#0B0E17] border border-[#1C253B] rounded-lg p-3 space-y-2.5">
                            <div className="flex items-center justify-between border-b border-[#1C253B] pb-1.5">
                              <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
                                <CornerDownRight className="w-3.5 h-3.5" />
                                <span>RESPONSE</span>
                              </div>
                              {getStatusBadge(entry.status, entry.apiDetails?.statusText)}
                            </div>

                            {/* Metrics Grid */}
                            <div className="grid grid-cols-2 gap-2 text-[11px]">
                              <div className="bg-[#07090E] p-2 rounded border border-[#171E2E]">
                                <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Duration</div>
                                <div className="text-white font-bold mt-0.5 flex items-center gap-1">
                                  <Clock className="w-3 h-3 text-slate-400" />
                                  {entry.duration || entry.apiDetails?.duration || 'Not captured'}
                                </div>
                              </div>
                              <div className="bg-[#07090E] p-2 rounded border border-[#171E2E]">
                                <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Response Size</div>
                                <div className="text-white font-bold mt-0.5 flex items-center gap-1">
                                  <HardDrive className="w-3 h-3 text-slate-400" />
                                  {entry.apiDetails?.responseSize || 'Not captured'}
                                </div>
                              </div>
                            </div>

                            {/* Response Headers */}
                            <div>
                              <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-1">Response Headers</div>
                              {entry.apiDetails?.responseHeaders ? (
                                <pre className={`bg-[#07090E] p-2 rounded border border-[#171E2E] text-slate-300 text-[11px] overflow-x-auto whitespace-pre-wrap font-mono ${isMaximized ? 'max-h-60' : 'max-h-36'}`}>
                                  {entry.apiDetails.responseHeaders}
                                </pre>
                              ) : (
                                <div className="bg-[#07090E] p-2 rounded border border-[#171E2E] text-slate-500 text-[11px] italic">
                                  Not captured
                                </div>
                              )}
                            </div>

                            {/* Response Body */}
                            <div>
                              <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-1">Response Body</div>
                              {entry.apiDetails?.responseBody?.text ? (
                                entry.apiDetails.responseBody.isJson ? (
                                  <JsonSyntaxViewer
                                    json={entry.apiDetails.responseBody.text}
                                    maxHeightClass={isMaximized ? 'max-h-96' : 'max-h-48'}
                                    showLineNumbers={true}
                                  />
                                ) : (
                                  <pre className={`bg-[#07090E] p-2 rounded border border-[#171E2E] text-amber-300 text-[11px] overflow-x-auto whitespace-pre-wrap font-mono ${isMaximized ? 'max-h-96' : 'max-h-48'}`}>
                                    {entry.apiDetails.responseBody.text}
                                  </pre>
                                )
                              ) : (
                                <div className="bg-[#07090E] p-2 rounded border border-[#171E2E] text-slate-500 text-[11px] italic">
                                  Not captured
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Crash Diagnostics Detailed Panel */}
                      {isCrash && (
                        <div className="space-y-3">
                          {/* Crash Summary Metrics Grid */}
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                            <div className="bg-[#0B0E17] p-2 rounded border border-rose-900/30">
                              <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Thread</div>
                              <div className="text-rose-300 font-bold mt-0.5 truncate">{entry.crashDetails?.thread || 'main'}</div>
                            </div>
                            <div className="bg-[#0B0E17] p-2 rounded border border-rose-900/30">
                              <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Process</div>
                              <div className="text-slate-300 font-bold mt-0.5 truncate">{entry.crashDetails?.process || 'N/A'}</div>
                            </div>
                            <div className="bg-[#0B0E17] p-2 rounded border border-rose-900/30">
                              <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">PID</div>
                              <div className="text-amber-300 font-bold mt-0.5">{entry.crashDetails?.pid || 'N/A'}</div>
                            </div>
                            <div className="bg-[#0B0E17] p-2 rounded border border-rose-900/30">
                              <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Status</div>
                              <div className="text-rose-400 font-bold mt-0.5">FATAL EXCEPTION</div>
                            </div>
                          </div>

                          {/* Exception Type & Message */}
                          <div className="bg-[#0B0E17] p-2.5 rounded border border-rose-900/40 space-y-1">
                            <div className="text-[10px] text-rose-400 uppercase tracking-wider font-semibold">Exception Type</div>
                            <div className="text-rose-200 text-xs font-bold break-all select-all">
                              {entry.crashDetails?.exceptionType || 'java.lang.RuntimeException'}
                            </div>
                            {entry.crashDetails?.message && (
                              <>
                                <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold pt-1">Exception Message</div>
                                <div className="text-slate-300 text-xs break-all select-all font-medium">
                                  {entry.crashDetails.message}
                                </div>
                              </>
                            )}
                          </div>

                          {/* Stack Trace */}
                          <div>
                            <div className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mb-1 flex items-center justify-between">
                              <span className="flex items-center gap-1.5 text-rose-400">
                                <Flame className="w-3 h-3 text-rose-500" /> Complete Stack Trace
                              </span>
                              <span className="text-[10px] text-slate-500">Android Runtime Frames</span>
                            </div>
                            <pre className={`bg-[#07090E] p-3 rounded border border-rose-900/40 text-rose-300 text-[11px] overflow-x-auto whitespace-pre font-mono leading-relaxed select-all ${isMaximized ? 'max-h-80' : 'max-h-56'}`}>
                              {entry.crashDetails?.stackTrace || 'No stack trace captured'}
                            </pre>
                          </div>

                          {/* Caused By Chain (if present) */}
                          {entry.crashDetails?.causedBy && (
                            <div>
                              <div className="text-[10px] text-amber-400 uppercase tracking-wider font-semibold mb-1 flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3 text-amber-400" /> Caused By Chain
                              </div>
                              <pre className={`bg-[#07090E] p-3 rounded border border-amber-900/40 text-amber-300 text-[11px] overflow-x-auto whitespace-pre font-mono leading-relaxed select-all ${isMaximized ? 'max-h-60' : 'max-h-40'}`}>
                                {entry.crashDetails.causedBy}
                              </pre>
                            </div>
                          )}

                          {/* Raw Crash Log */}
                          <div>
                            <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-1">
                              Raw Crash Log Stream
                            </div>
                            <pre className="bg-[#07090E] p-2.5 rounded border border-[#1C253B] text-slate-400 text-[11px] overflow-x-auto whitespace-pre font-mono max-h-36 select-all">
                              {entry.crashDetails?.rawLog || entry.rawText}
                            </pre>
                          </div>
                        </div>
                      )}

                      {/* Non-API & Non-Crash Detailed Log Content */}
                      {!isApi && !isCrash && (
                        <div className="space-y-2">
                          <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Raw Event Details</div>
                          <pre className="bg-[#0B0E17] p-2.5 rounded border border-[#1C253B] text-slate-200 text-[11px] overflow-x-auto whitespace-pre-wrap font-mono">
                            {entry.rawText}
                          </pre>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            );
          })
        )}
      </div>
    </>
  );

  if (isMaximized) {
    return (
      <>
        {/* Placeholder in document flow so page layout remains unchanged underneath */}
        <div className="bg-[#0A0D14]/40 border border-dashed border-[#1E2638] rounded-xl h-[520px] flex items-center justify-center text-slate-500 text-xs font-mono p-4 select-none">
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="p-2.5 rounded-lg bg-[#131924] border border-[#1E2638]">
              <Terminal className="w-5 h-5 text-[#F59E0B]" />
            </div>
            <span className="text-slate-300 font-semibold text-xs">Live Execution Console is expanded</span>
            <span className="text-slate-500 text-[11px]">Press ESC or click Minimize / Close to restore view</span>
            <button
              onClick={() => setIsMaximized(false)}
              className="mt-1 px-3 py-1 rounded bg-[#1E2638] text-xs text-slate-300 hover:text-white border border-[#2A3752] transition-colors"
            >
              Restore Embedded View
            </button>
          </div>
        </div>

        {/* Viewport Overlay Modal */}
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-3 md:p-6 animate-fadeIn"
          role="dialog"
          aria-modal="true"
          aria-label="Expanded Live Execution Console & HTTP Inspector"
        >
          <div className="w-[calc(100vw-24px)] h-[calc(100vh-24px)] md:w-[58vw] md:h-[92vh] max-w-[1200px] max-h-[900px] bg-[#0A0D14] border border-[#1E2638] rounded-xl shadow-2xl overflow-hidden flex flex-col">
            {consoleInnerContent}
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="bg-[#0A0D14] border border-[#1E2638] rounded-xl overflow-hidden flex flex-col h-[520px] shadow-2xl">
      {consoleInnerContent}
    </div>
  );
}


