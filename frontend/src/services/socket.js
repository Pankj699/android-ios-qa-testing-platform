import { getAuthToken } from './api';

class TestSocketService {
  constructor() {
    this.ws = null;
    this.listeners = new Map(); // eventType -> Set of callbacks
    this.currentTestId = null;
    this.reconnectTimer = null;
  }

  connect(testId = null) {
    this.currentTestId = testId;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const token = getAuthToken() || '';
    
    const params = new URLSearchParams();
    if (testId) params.append('testId', testId);
    if (token) params.append('token', token);
    
    const queryString = params.toString() ? `?${params.toString()}` : '';
    const url = `${protocol}//${host}/ws${queryString}`;

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      if (testId) {
        this.send({ action: 'SUBSCRIBE', testId });
      }
      return;
    }

    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        if (testId) {
          this.send({ action: 'SUBSCRIBE', testId });
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.emit(data.type, data);
          this.emit('*', data);
        } catch (e) {
          console.error('[WS] Parse error:', e);
        }
      };

      this.ws.onclose = () => {
        // Attempt reconnection after 3 seconds
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => {
          this.connect(this.currentTestId);
        }, 3000);
      };

      this.ws.onerror = (err) => {
        console.error('[WS] Error:', err);
      };
    } catch (e) {
      console.error('[WS] Connect error:', e);
    }
  }

  subscribeToTest(testId) {
    this.currentTestId = testId;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.send({ action: 'SUBSCRIBE', testId });
    } else {
      this.connect(testId);
    }
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  on(eventType, callback) {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType).add(callback);
    return () => this.off(eventType, callback);
  }

  off(eventType, callback) {
    if (this.listeners.has(eventType)) {
      this.listeners.get(eventType).delete(callback);
    }
  }

  emit(eventType, data) {
    const handlers = this.listeners.get(eventType);
    if (handlers) {
      handlers.forEach(fn => fn(data));
    }
  }

  disconnect() {
    clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

export const socketService = new TestSocketService();
