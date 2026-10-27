import React, { useState, useEffect } from 'react';
import { X, Copy, Check, RefreshCw, Smartphone, Laptop, AlertCircle, ShieldCheck } from 'lucide-react';
import { api } from '../services/api';

export default function PairAgentModal({ isOpen, onClose, onAgentPaired }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [pairingData, setPairingData] = useState(null);
  const [copied, setCopied] = useState(false);
  const [timeLeft, setTimeLeft] = useState(300);

  const fetchPairingCode = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.generateAgentPairingCode();
      setPairingData(res);
      setTimeLeft(res.expiresInSeconds || 300);
    } catch (err) {
      setError(err.message || 'Failed to generate agent pairing code.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchPairingCode();
    } else {
      setPairingData(null);
      setError(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!pairingData || timeLeft <= 0) return;
    const timer = setInterval(() => {
      setTimeLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [pairingData, timeLeft]);

  const handleCopy = () => {
    if (!pairingData?.pairingCode) return;
    navigator.clipboard.writeText(pairingData.pairingCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  if (!isOpen) return null;

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const formattedTime = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="glass rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl border border-[var(--line)]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--line)]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[var(--violet)] to-[var(--pink)] flex items-center justify-center text-white shadow-md shadow-[var(--violet)]/20">
              <Laptop className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[var(--ink)]">Pair QA Device Agent</h3>
              <p className="text-xs text-[var(--muted)]">Connect your local PC & iPhone to your QA session</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--card)] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          {error && (
            <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-start gap-3 text-xs text-rose-500">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center space-y-3">
              <RefreshCw className="w-8 h-8 text-[var(--violet)] animate-spin" />
              <p className="text-xs text-[var(--muted)]">Generating secure pairing code...</p>
            </div>
          ) : pairingData ? (
            <div className="space-y-5">
              {/* Pairing Code Display */}
              <div className="p-6 rounded-2xl glass border border-[var(--line)] text-center space-y-2 relative overflow-hidden shadow-inner">
                <div className="text-[11px] font-bold tracking-wider uppercase text-[var(--violet)]">
                  Your 6-Digit Pairing Code
                </div>
                <div className="text-4xl font-extrabold tracking-[0.25em] text-[var(--ink)] font-mono flex items-center justify-center pl-4">
                  {pairingData.pairingCode}
                </div>
                <div className="text-[11px] text-[var(--muted)] flex items-center justify-center gap-1.5 pt-1">
                  <span>Expires in:</span>
                  <span className={`font-mono font-bold ${timeLeft < 60 ? 'text-rose-500' : 'text-amber-500'}`}>
                    {formattedTime}
                  </span>
                </div>

                <div className="pt-2 flex justify-center gap-2">
                  <button
                    onClick={handleCopy}
                    className="btn-magic px-4 py-2 rounded-xl text-white text-xs font-semibold flex items-center gap-1.5 transition-all shadow-md cursor-pointer"
                  >
                    {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? 'Copied Code!' : 'Copy Code'}</span>
                  </button>
                  <button
                    onClick={fetchPairingCode}
                    className="btn-soft px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                    title="Generate New Code"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Refresh</span>
                  </button>
                </div>
              </div>

              {/* Instructions */}
              <div className="p-4 rounded-xl glass border border-[var(--line)] text-xs space-y-2.5">
                <div className="font-semibold text-[var(--ink)] flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-500" /> How to connect:
                </div>
                <ol className="list-decimal list-inside space-y-1.5 text-[var(--muted)] leading-relaxed">
                  <li>Open <span className="text-[var(--ink)] font-mono bg-[var(--card)] px-1.5 py-0.5 rounded-md border border-[var(--line)]">qa-device-agent.exe</span> on your PC.</li>
                  <li>When prompted for Server URL, press <span className="text-[var(--ink)] font-semibold">Enter</span> (or type your server IP).</li>
                  <li>Enter the <span className="text-[var(--violet)] font-bold font-mono">{pairingData.pairingCode}</span> code shown above.</li>
                  <li>Plug in your iPhone via USB and tap <span className="text-[var(--ink)] font-semibold">"Trust This Computer"</span>.</li>
                </ol>
              </div>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-6 py-4 border-t border-[var(--line)]">
          <button
            onClick={onClose}
            className="btn-soft px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
