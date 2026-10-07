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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
      <div className="bg-[#111622] border border-[#1E2638] rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1E2638] bg-[#0E131E]">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400">
              <Laptop className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Pair QA Device Agent</h3>
              <p className="text-xs text-[#94A3B8]">Connect your local PC & iPhone to your QA session</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#94A3B8] hover:text-white hover:bg-[#1E2638] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          {error && (
            <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 flex items-start gap-3 text-xs text-red-400">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center space-y-3">
              <RefreshCw className="w-8 h-8 text-blue-400 animate-spin" />
              <p className="text-xs text-[#94A3B8]">Generating secure pairing code...</p>
            </div>
          ) : pairingData ? (
            <div className="space-y-5">
              {/* Pairing Code Display */}
              <div className="p-6 rounded-2xl bg-[#0A0D14] border border-blue-500/30 text-center space-y-2 relative overflow-hidden">
                <div className="text-[11px] font-medium tracking-wider uppercase text-blue-400">
                  Your 6-Digit Pairing Code
                </div>
                <div className="text-4xl font-extrabold tracking-[0.25em] text-white font-mono flex items-center justify-center pl-4">
                  {pairingData.pairingCode}
                </div>
                <div className="text-[11px] text-[#94A3B8] flex items-center justify-center gap-1.5 pt-1">
                  <span>Expires in:</span>
                  <span className={`font-mono font-bold ${timeLeft < 60 ? 'text-red-400' : 'text-blue-300'}`}>
                    {formattedTime}
                  </span>
                </div>

                <div className="pt-2 flex justify-center gap-2">
                  <button
                    onClick={handleCopy}
                    className="px-4 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? 'Copied Code!' : 'Copy Code'}</span>
                  </button>
                  <button
                    onClick={fetchPairingCode}
                    className="px-3 py-1.5 rounded-lg bg-[#1E2638] hover:bg-[#263248] text-[#CBD5E1] border border-[#334155] text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                    title="Generate New Code"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Refresh</span>
                  </button>
                </div>
              </div>

              {/* Instructions */}
              <div className="p-4 rounded-xl bg-[#0E131E] border border-[#1E2638] text-xs space-y-2.5">
                <div className="font-semibold text-white flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-green-400" /> How to connect:
                </div>
                <ol className="list-decimal list-inside space-y-1.5 text-[#94A3B8] leading-relaxed">
                  <li>Open <span className="text-white font-mono bg-[#0A0D14] px-1.5 py-0.5 rounded border border-[#1E2638]">qa-device-agent.exe</span> on your PC.</li>
                  <li>When prompted for Server URL, press <span className="text-white font-semibold">Enter</span> (or type your server IP).</li>
                  <li>Enter the <span className="text-blue-300 font-bold font-mono">{pairingData.pairingCode}</span> code shown above.</li>
                  <li>Plug in your iPhone via USB and tap <span className="text-white font-semibold">"Trust This Computer"</span>.</li>
                </ol>
              </div>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-6 py-4 border-t border-[#1E2638] bg-[#0E131E]">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-[#1E2638] hover:bg-[#263248] text-xs font-semibold text-[#CBD5E1] transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
