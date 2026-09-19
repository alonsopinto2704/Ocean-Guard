import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Badge } from '../components/ui/Badge';
import { Activity, Eye, EyeOff, KeyRound, Map, Rocket, Satellite, Target, Waves, CheckCircle2 } from 'lucide-react';
import { SkipLink } from '../components/ui/SkipLink';
import { authApi } from '../lib/api';

const DEMO_ACCOUNTS = [
  { email: 'admin@oceanguard.ai',    label: 'Admin',                 desc: 'Chief Operations Administrator', color: '#ff4455' },
  { email: 'operator@oceanguard.ai', label: 'Field Operator',        desc: 'Senior Marine Radar & Drone Pilot', color: '#00d4ff' },
  { email: 'officer@oceanguard.ai',  label: 'Environmental Officer', desc: 'Lead Oceanographer', color: '#00ff88' },
  { email: 'cleanup@oceanguard.ai',  label: 'Cleanup Team',          desc: 'Coastal Team A Lead', color: '#ffaa00' },
];

// Login page: credentials form, quick demo-role buttons, branding panel,
// and the account-recovery (token request + password reset) modal.
export default function Login() {
  const { login, isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail]       = useState('operator@oceanguard.ai');
  const [password, setPassword] = useState('demo1234');
  const [showPw, setShowPw]     = useState(false);
  const [error, setError]       = useState('');

  // Account recovery state
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoveryMsg, setRecoveryMsg] = useState('');
  const [recoveryToken, setRecoveryToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [resetSuccess, setResetSuccess] = useState(false);
  const [recoveryLoading, setRecoveryLoading] = useState(false);

  const from = (location.state as any)?.from?.pathname || '/command';

  useEffect(() => {
    if (isAuthenticated) {
      navigate(from, { replace: true });
    }
  }, [isAuthenticated, navigate, from]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch (err: any) {
      setError(err.message || 'Authentication failed. Please verify credentials.');
    }
  };

  // One-click demo login: fills the form fields AND authenticates immediately.
  const handleQuickLogin = async (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword('demo1234');
    setError('');
    try {
      await login(demoEmail, 'demo1234');
      navigate(from, { replace: true });
    } catch (err: any) {
      setError(err.message || 'Login failed. Please try again.');
    }
  };

  // Step 1 of recovery: request a reset token for the given email.
  const handleRequestRecovery = async (e: FormEvent) => {
    e.preventDefault();
    if (!recoveryEmail) return;
    setRecoveryLoading(true);
    setRecoveryMsg('');
    try {
      const res = await authApi.recover(recoveryEmail);
      setRecoveryMsg(res.message);
      if (res.resetToken) {
        setRecoveryToken(res.resetToken);
      }
    } catch (err: any) {
      setRecoveryMsg(err.message || 'Failed to dispatch recovery.');
    } finally {
      setRecoveryLoading(false);
    }
  };

  // Step 2 of recovery: exchange the token for a new password.
  const handleResetPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (!recoveryToken || !newPassword) return;
    setRecoveryLoading(true);
    try {
      await authApi.resetPassword(recoveryToken, newPassword);
      setResetSuccess(true);
      setRecoveryMsg('Password updated successfully. You can now log in.');
      setPassword(newPassword);
      setEmail(recoveryEmail);
    } catch (err: any) {
      setRecoveryMsg(err.message || 'Password update failed.');
    } finally {
      setRecoveryLoading(false);
    }
  };

  return (
    <>
      <SkipLink />
      <main id="main-content" tabIndex={-1} className="min-h-screen flex bg-[var(--ocean-bg)] relative overflow-hidden outline-none">
        {/* Grid pattern background */}
        <div className="absolute inset-0 grid-pattern opacity-30 pointer-events-none" />

        {/* Left panel — branding */}
        <div className="hidden lg:flex flex-col flex-1 items-center justify-center p-12 relative">
          <div className="max-w-md text-center">
            {/* Ocean animated icon */}
            <div className="relative w-24 h-24 mx-auto mb-8">
              <div className="absolute inset-0 rounded-full border-2 border-[#00f5d4]/30 animate-ping" />
              <div className="absolute inset-2 rounded-full border border-[#4cd6fb]/20 animate-ping" style={{ animationDelay: '0.5s' }} />
              <div className="w-24 h-24 rounded-full border-2 border-[#00f5d4]/60 bg-[#00f5d4]/10 flex items-center justify-center shadow-[0_0_30px_rgba(0,245,212,0.2)]">
                <Waves className="w-10 h-10 text-[#00f5d4]" />
              </div>
            </div>

            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#161c28] border border-[#3a4a46]/50 mb-3">
              <span className="h-1.5 w-1.5 rounded-full bg-[#00f5d4] pulse-dot" />
              <span className="font-telemetry-tag text-[9px] uppercase tracking-widest text-[#00f5d4] font-bold">
                DEFENSE-GRADE ECOLOGICAL TELEMETRY
              </span>
            </div>

            <h1 className="font-headline-xl text-4xl font-bold text-[#dde2f3] mb-3 tracking-wide uppercase">
              Ocean<span className="text-[#00f5d4]">Guard</span> AI
            </h1>
            <p className="font-body-md text-[#b9cac4] text-base mb-8 leading-relaxed">
              Sub-millimeter autonomous spatial intelligence & neural computer vision combating marine debris across coastal watch zones.
            </p>

            {/* Feature list */}
            <div className="space-y-1">
              {[
                { icon: <Target className="h-4 w-4" />, text: 'Real-time AI debris target acquisition & tracking' },
                { icon: <Satellite className="h-4 w-4" />, text: 'Camera & aerial drone telemetry monitoring' },
                { icon: <Map className="h-4 w-4" />, text: 'Thermodynamic gyre circulation & hotspot clustering' },
                { icon: <Rocket className="h-4 w-4" />, text: 'Automated retrieval & cleanup mission coordination' },
                { icon: <Activity className="h-4 w-4" />, text: 'Empirical environmental impact & verified recovery records' },
              ].map(f => (
                <div key={f.text} className="flex items-center gap-3 text-left py-1.5 px-3 rounded bg-[#161c28]/40 border border-[#3a4a46]/20">
                  <span className="text-[#4cd6fb]" aria-hidden="true">{f.icon}</span>
                  <span className="font-data-mono-sm text-xs text-[#dde2f3] font-mono">{f.text}</span>
                </div>
              ))}
            </div>

            {/* Status bar */}
            <div className="mt-8 p-4 rounded bg-[#161c28]/80 border border-[#3a4a46]/50 shadow-lg">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-[#83948f] font-telemetry-tag uppercase">System Status</span>
                <span className="flex items-center gap-1.5 text-[#00f5d4] font-bold">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#00f5d4] pulse-dot inline-block shadow-[0_0_6px_#00f5d4]" />
                  ONLINE // TELEMETRY SYNCED
                </span>
              </div>
              <div className="flex items-center justify-between text-xs font-mono mt-2">
                <span className="text-[#83948f] font-telemetry-tag uppercase">AI Engine</span>
                <span className="text-[#00f5d4] font-bold">ESPADA V1 · SELF-HOSTED</span>
              </div>
              <div className="flex items-center justify-between text-xs font-mono mt-2">
                <span className="text-[#83948f] font-telemetry-tag uppercase">Session Security</span>
                <span className="text-[#4cd6fb] font-bold">RBAC ENFORCED · 24H EXPIRY</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right panel — login form */}
        <div className="relative z-10 flex flex-col w-full lg:w-[460px] flex-shrink-0 min-h-screen bg-[var(--ocean-surface)] border-l border-[var(--ocean-border)]">
          <div className="flex-1 flex flex-col justify-center p-5 sm:p-8">
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-4 lg:hidden">
                <Waves className="w-6 h-6 text-cyan-400" />
                <span className="text-lg font-bold text-[var(--ocean-text)]">OceanGuard AI</span>
              </div>
              <h2 className="text-xl font-bold text-[var(--ocean-text)]">Mission Authentication</h2>
              <p className="text-xs text-[var(--ocean-text-dim)] mt-1">
                Enter your operator credentials to establish an authenticated session.
              </p>
            </div>

            <button
              type="button"
              onClick={() => navigate('/portal')}
              className="mb-5 inline-flex min-h-9 items-center gap-2 self-start rounded text-xs font-medium text-[#4cd6fb] underline-offset-4 transition-colors hover:text-[#d7fff3] hover:underline"
            >
              Explore the public ocean portal →
            </button>

            {/* Login form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="login-email" className="block text-xs font-medium text-[var(--ocean-text-dim)] mb-1.5 uppercase tracking-wider">
                  Email / Operator ID
                </label>
                <input
                  type="email"
                  id="login-email"
                  name="email"
                  autoComplete="username"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-bg)] text-[var(--ocean-text)] text-sm focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/20 outline-none transition-all"
                  placeholder="operator@oceanguard.ai"
                  required
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="login-password" className="block text-xs font-medium text-[var(--ocean-text-dim)] uppercase tracking-wider">
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => { setShowRecovery(true); setRecoveryEmail(email); }}
                    className="text-[11px] text-cyan-400 hover:underline hover:text-cyan-300"
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    id="login-password"
                    name="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="w-full px-3 py-2.5 pr-12 rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-bg)] text-[var(--ocean-text)] text-sm focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/20 outline-none transition-all"
                    placeholder="••••••••"
                    required
                  />
                  <button
                    type="button"
                    aria-label={showPw ? 'Hide password' : 'Show password'}
                    onClick={() => setShowPw(v => !v)}
                    className="absolute inset-y-0 right-0 inline-flex w-11 items-center justify-center rounded-r-lg text-[var(--ocean-text-muted)] hover:text-[var(--ocean-text-dim)]"
                  >
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <div role="alert" className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
                  {error}
                </div>
              )}

              <Button variant="primary" size="md" fullWidth loading={isLoading} type="submit">
                Authenticate & Enter System
              </Button>
            </form>

            {/* Isolated Demo Accounts Section */}
            <div className="mt-7 pt-5 border-t border-[var(--ocean-border)]">
              <div className="flex items-center justify-between gap-2 mb-3">
                <span className="text-[10px] font-mono text-[var(--ocean-text-muted)] uppercase tracking-widest">
                  Quick-Demo Profiles
                </span>
                <Badge variant="amber" size="xs">ISOLATED DEMO</Badge>
              </div>
              <p className="text-[11px] text-[var(--ocean-text-muted)] mb-3">
                Click any operational role below to populate credentials and test role-based access control.
              </p>
              <div className="grid grid-cols-2 gap-2">
                {DEMO_ACCOUNTS.map(acc => (
                  <button
                    key={acc.email}
                    type="button"
                    disabled={isLoading}
                    onClick={() => handleQuickLogin(acc.email)}
                    className="min-h-16 text-left p-2.5 rounded-lg border border-[var(--ocean-border)] hover:border-cyan-500/40 bg-[var(--ocean-bg)] transition-all group cursor-pointer"
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: acc.color }} />
                      <span className="text-xs font-semibold text-[var(--ocean-text)] group-hover:text-cyan-400 transition-colors truncate">
                        {acc.label}
                      </span>
                    </div>
                    <span className="text-[10px] text-[var(--ocean-text-muted)] block truncate">{acc.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-[var(--ocean-border)] text-center">
            <p className="text-[10px] text-[var(--ocean-text-muted)]">
              OceanGuard AI Platform v1.4 · Defense & Ecological Telemetry
            </p>
          </div>
        </div>

        {/* Account Recovery Modal */}
        {/* Account Recovery Modal — reset the FULL flow on close.
            BUGFIX: recoveryToken/newPassword were previously left set, so
            reopening the modal skipped straight to the stale reset form. */}
        <Modal
          isOpen={showRecovery}
          onClose={() => {
            setShowRecovery(false);
            setRecoveryMsg('');
            setResetSuccess(false);
            setRecoveryToken('');
            setNewPassword('');
          }}
          title="Account Recovery & Password Reset"
          size="md"
        >
          <div className="space-y-4">
            <p className="text-xs text-[var(--ocean-text-dim)]">
              Reset access for verified OceanGuard operator accounts.
            </p>

            {!recoveryToken ? (
              <form onSubmit={handleRequestRecovery} className="space-y-3">
                <div>
                  <label htmlFor="recovery-email" className="block text-xs font-medium text-[var(--ocean-text-dim)] mb-1 uppercase tracking-wider">
                    Institutional Email
                  </label>
                  <input
                    id="recovery-email"
                    type="email"
                    value={recoveryEmail}
                    onChange={e => setRecoveryEmail(e.target.value)}
                    placeholder="operator@oceanguard.ai"
                    required
                    className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-bg)] text-[var(--ocean-text)] focus:border-cyan-500 outline-none"
                  />
                </div>
                <Button variant="primary" size="sm" fullWidth loading={recoveryLoading} type="submit" icon={<KeyRound className="w-3.5 h-3.5" />}>
                  Generate Recovery Token
                </Button>
              </form>
            ) : !resetSuccess ? (
              <form onSubmit={handleResetPassword} className="space-y-3">
                <div className="p-2.5 rounded bg-cyan-950/30 border border-cyan-500/30 text-xs text-cyan-300 font-mono">
                  Token: {recoveryToken}
                </div>
                <div>
                  <label htmlFor="recovery-new-pw" className="block text-xs font-medium text-[var(--ocean-text-dim)] mb-1 uppercase tracking-wider">
                    New Password (min 6 characters)
                  </label>
                  <input
                    id="recovery-new-pw"
                    type="password"
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    placeholder="Enter new password"
                    minLength={6}
                    required
                    className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--ocean-border)] bg-[var(--ocean-bg)] text-[var(--ocean-text)] focus:border-cyan-500 outline-none"
                  />
                </div>
                <Button variant="primary" size="sm" fullWidth loading={recoveryLoading} type="submit">
                  Save New Password
                </Button>
              </form>
            ) : (
              <div className="flex flex-col items-center gap-2 p-4 text-center">
                <CheckCircle2 className="w-8 h-8 text-green-400" />
                <p className="text-sm font-semibold text-green-400">Password Reset Complete</p>
                <p className="text-xs text-[var(--ocean-text-dim)]">You can now authenticate with your new credentials.</p>
                <Button variant="outline" size="sm" onClick={() => setShowRecovery(false)}>
                  Return to Sign In
                </Button>
              </div>
            )}

            {recoveryMsg && (
              <div className="p-2.5 rounded bg-[var(--ocean-bg)] border border-[var(--ocean-border)] text-xs text-[var(--ocean-text)]">
                {recoveryMsg}
              </div>
            )}
          </div>
        </Modal>
      </main>
    </>
  );
}
