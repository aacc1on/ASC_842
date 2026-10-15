import { useEffect, useState } from 'react';
import { Shield, Smartphone, Plus, Trash2, CheckCircle, AlertCircle, Loader2, QrCode } from 'lucide-react';
import { useMfa } from '../../hooks/useMfa';

interface MfaSectionProps {
  userRole: string;
}

export function MfaSection({ userRole }: MfaSectionProps) {
  const mfa = useMfa();
  const { loadFactors } = mfa;
  const [showEnroll, setShowEnroll] = useState(false);

  useEffect(() => {
    loadFactors();
  }, [loadFactors]);

  const hasVerified = mfa.factors.some((f) => f.status === 'verified');
  const showBanner = (userRole === 'admin' || userRole === 'manage') && !hasVerified;

  return (
    <div className="border-t border-slate-200 pt-8">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 mb-1">Two-Factor Authentication</h2>
          <p className="text-sm text-slate-500">Add an extra layer of security with an authenticator app.</p>
        </div>
      </div>

      {showBanner && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
          <Shield className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-amber-800">Secure your account</p>
            <p className="text-xs text-amber-700 mt-1">
              As an admin or manager, you handle sensitive data. Enroll an authenticator app to protect your account.
            </p>
          </div>
        </div>
      )}

      {mfa.error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-600" />
          <p className="text-sm text-red-700">{mfa.error}</p>
        </div>
      )}

      {mfa.loading ? (
        <div className="flex items-center gap-2 text-slate-500 text-sm py-4">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading...
        </div>
      ) : hasVerified ? (
        <div className="space-y-3">
          {mfa.factors.filter((f) => f.status === 'verified').map((f) => (
            <div key={f.id} className="flex items-center justify-between p-4 bg-green-50 border border-green-200 rounded-lg">
              <div className="flex items-center gap-3">
                <Smartphone className="w-5 h-5 text-green-600" />
                <div>
                  <p className="text-sm font-bold text-slate-800">{f.friendly_name}</p>
                  <p className="text-xs text-green-700 flex items-center gap-1 mt-0.5">
                    <CheckCircle className="w-3 h-3" /> Active
                  </p>
                </div>
              </div>
              <button
                onClick={() => mfa.unenroll(f.id)}
                className="p-2 text-slate-500 hover:text-red-600 transition"
                title="Remove"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      ) : showEnroll && mfa.enrollQrUrl ? (
        <div className="space-y-4 p-4 bg-slate-50 rounded-lg">
          <div className="flex flex-col items-center gap-3">
            <div className="bg-white p-4 rounded-lg border border-slate-200">
              <QrCode className="w-32 h-32 text-slate-900" />
            </div>
            <p className="text-sm text-slate-600 text-center max-w-xs">
              Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.)
            </p>
            <div className="w-full">
              <label className="block text-xs font-bold text-slate-700 mb-1">Or enter this code manually:</label>
              <input
                type="text"
                value={mfa.enrollSecret || ''}
                readOnly
                className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1.5">Enter the 6-digit code from your app</label>
            <input
              type="text"
              value={mfa.verifyCode}
              onChange={(e) => mfa.setVerifyCode(e.target.value)}
              placeholder="000000"
              maxLength={6}
              className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none font-mono text-lg tracking-widest text-center"
            />
          </div>
          <div className="flex gap-3">
            <button
              onClick={mfa.cancelEnroll}
              className="flex-1 px-4 py-3 border border-slate-300 text-slate-700 font-semibold rounded-lg hover:bg-slate-50 transition"
            >
              Cancel
            </button>
            <button
              onClick={() => { mfa.verifyEnroll(); setShowEnroll(false); }}
              disabled={mfa.verifyCode.length !== 6}
              className="flex-1 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition disabled:opacity-50"
            >
              Verify & Enable
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => { setShowEnroll(true); mfa.startEnroll(); }}
          className="flex items-center gap-2 px-4 py-2.5 border border-slate-300 text-slate-700 font-semibold rounded-lg hover:bg-slate-50 transition"
        >
          <Plus className="w-4 h-4" />
          Set up authenticator app
        </button>
      )}
    </div>
  );
}
