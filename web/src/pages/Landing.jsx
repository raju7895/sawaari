import { Link } from 'react-router-dom';
import { ArrowRight, MapPin, ShieldCheck, Wallet, Clock, PhoneCall, Sparkles, Navigation, Star, Server } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTheme } from '../context/ThemeContext';
import LogoMark from '../components/LogoMark';
import { useAuth } from '../context/AuthContext';
import { homeFor } from '../roles';
import InstallPrompt from '../components/InstallPrompt';

export default function Landing() {
  const { user, profile } = useAuth();
  const { dark, toggle } = useTheme();
  const [serverOpen, setServerOpen] = useState(false);

  useEffect(() => {
  }, []);

  const home = homeFor(user?.role);
  const ctaLabel = user ? 'Go to dashboard' : 'Get started';

  return (
    <div className="min-h-full bg-slate-50 dark:bg-slate-950">
      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/80 backdrop-blur dark:border-slate-800/70 dark:bg-slate-950/80">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <LogoMark size={32} />
            <span className="text-xl font-extrabold">Sawaari</span>
          </div>
          <nav className="hidden items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-300 md:flex">
            <a href="#how" className="hover:text-brand-600">How it works</a>
            <a href="#cities" className="hover:text-brand-600">Cities</a>
            <a href="#drivers" className="hover:text-brand-600">Drive with us</a>
          </nav>
          <div className="flex items-center gap-2">
            <button onClick={toggle} className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Toggle theme">
              <span className="text-lg">{dark ? '☀️' : '🌙'}</span>
            </button>
            {user ? (
              <Link to={home} className="btn-primary">{ctaLabel}</Link>
            ) : (
              <>
                <Link to="/login" className="btn-ghost hidden sm:inline-flex">Log in</Link>
                <Link to="/register" className="btn-primary">Sign up <ArrowRight className="h-4 w-4" /></Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 pb-16 pt-14 md:grid-cols-2 md:items-center md:pt-20">
          <div>
            <p className="badge mb-4 bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
              <Sparkles className="h-3.5 w-3.5" /> Live autos near you
            </p>
            <h1 className="text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
              Stranded? An auto is
              <span className="text-brand-600 dark:text-brand-400"> minutes away.</span>
            </h1>
            <p className="mt-4 max-w-md text-lg text-slate-600 dark:text-slate-300">
              Sawaari connects you with verified auto-rickshaw drivers nearby. See the real road distance,
              an honest fare, and track your driver live — from pickup to drop.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                to={user ? homeFor(profile?.role) : '/register'}
                className="btn-primary px-6 py-3 text-base"
              >
                {profile?.role === 'driver' ? 'Open driver console'
                  : profile?.role === 'admin' ? 'Open admin console'
                    : 'Book an auto'} <ArrowRight className="h-5 w-5" />
              </Link>
              <Link to="/register" className="btn-secondary px-6 py-3 text-base">Become a driver</Link>
            </div>
            <div className="mt-8 flex items-center gap-6 text-sm text-slate-500 dark:text-slate-400">
              <span className="flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-brand-600" /> Verified drivers</span>
              <span className="flex items-center gap-1.5"><Wallet className="h-4 w-4 text-brand-600" /> UPI &amp; cash</span>
              <span className="flex items-center gap-1.5"><Clock className="h-4 w-4 text-brand-600" /> 24×7</span>
            </div>
          </div>

          {/* Hero illustration — original auto artwork */}
          <div className="relative mx-auto w-full max-w-md">
            <div className="card overflow-hidden p-0">
              <div className="relative h-64 bg-gradient-to-br from-brand-500 to-teal-700 p-6">
                <svg viewBox="0 0 400 220" className="h-full w-full">
                  {/* road */}
                  <line x1="0" y1="190" x2="400" y2="190" stroke="rgba(255,255,255,.5)" strokeWidth="3" strokeDasharray="18 14" />
                  {/* auto body */}
                  <g transform="translate(120,55)">
                    <path d="M18 110 h130 v22 a8 8 0 0 1-8 8 H26 a8 8 0 0 1-8-8 z" fill="#f6c445" />
                    <path d="M28 110 v-52 q0-10 10-16 l34-24 q8-5 16-5 h34 q8 0 14 5 l18 13 q12 8 12 22 v57 z" fill="#f6c445" />
                    <path d="M48 106 v-48 l24-18 q6-4 12-4 h24 q6 0 11 4 l13 10 q8 6 8 14 v42 z" fill="#0d9488" opacity="0.92"/>
                    <rect x="46" y="58" width="82" height="46" rx="4" fill="#dbeafe" opacity="0.35"/>
                    <circle cx="45" cy="128" r="16" fill="#1e293b"/><circle cx="45" cy="128" r="6" fill="#94a3b8"/>
                    <circle cx="132" cy="128" r="16" fill="#1e293b"/><circle cx="132" cy="128" r="6" fill="#94a3b8"/>
                    <circle cx="96" cy="42" r="4" fill="#fff"/><circle cx="110" cy="42" r="4" fill="#fbbf24"/>
                  </g>
                  {/* pulsing pickup marker */}
                  <circle cx="70" cy="120" r="8" fill="#fff" /><circle cx="70" cy="120" r="14" fill="none" stroke="#fff" strokeWidth="2" opacity=".6">
                    <animate attributeName="r" values="10;20" dur="1.5s" repeatCount="indefinite"/>
                    <animate attributeName="opacity" values=".7;0" dur="1.5s" repeatCount="indefinite"/>
                  </circle>
                  <text x="52" y="98" fill="#fff" fontSize="11" fontWeight="700">YOU</text>
                </svg>
                <div className="absolute bottom-4 left-4 right-4 rounded-xl bg-white/95 p-3 shadow-lg dark:bg-slate-900/95">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 dark:bg-brand-900/50">🛺</span>
                      <div>
                        <p className="text-sm font-bold">2 autos nearby</p>
                        <p className="text-xs text-slate-500">Arriving in ~4 min</p>
                      </div>
                    </div>
                    <p className="tabular text-lg font-extrabold text-brand-700 dark:text-brand-300">₹86</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="border-t border-slate-200 bg-white py-16 dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="text-center text-3xl font-extrabold">Three taps to your ride</h2>
          <p className="mx-auto mt-2 max-w-lg text-center text-slate-500 dark:text-slate-400">
            No haggling, no uncertainty. You see the fare before you book.
          </p>
          <div className="mt-10 grid gap-6 sm:grid-cols-3">
            {[
              { icon: MapPin, title: 'Set pickup & drop', text: 'We detect your location, or search any address. Pick any custom points on the map.' },
              { icon: Navigation, title: 'See the real route & fare', text: 'Actual road distance, travel time and a complete fare breakdown — before you confirm.' },
              { icon: PhoneCall, title: 'Track & ride', text: 'Watch your driver approach live. Call or chat, share your trip, and pay by UPI, QR or cash.' },
            ].map((s, i) => (
              <div key={i} className="card p-6">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
                  <s.icon className="h-5 w-5" />
                </div>
                <p className="mb-1 text-xs font-bold uppercase tracking-widest text-brand-600 dark:text-brand-400">Step {i + 1}</p>
                <h3 className="text-lg font-bold">{s.title}</h3>
                <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">{s.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Cities */}
      <section id="cities" className="py-16">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="text-center text-3xl font-extrabold">Now serving</h2>
          <p className="mt-2 text-center text-slate-500 dark:text-slate-400">Live service areas with city-wise transparent pricing</p>
          <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {["Bengaluru", "Ahmedabad", "Pune", "Mumbai", "Delhi NCR"].map((c) => (
              <div key={c.id} className="card p-4 text-center">
                <MapPin className="mx-auto h-5 w-5 text-brand-600" />
                <p className="mt-2 font-bold">{c.name}</p>
                <p className="text-xs text-slate-400">{c.state}</p>
                {c.pricing?.[0] && (
                  <p className="tabular mt-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
                    ₹{c.pricing[0].baseFare} base + ₹{c.pricing[0].perKm}/km
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Driver CTA */}
      <section id="drivers" className="border-t border-slate-200 bg-white py-16 dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 md:grid-cols-2">
          <div>
            <p className="badge bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"><Star className="h-3.5 w-3.5" /> Drive with Sawaari</p>
            <h2 className="mt-3 text-3xl font-extrabold">Own vehicle? Earn on your schedule.</h2>
            <ul className="mt-4 space-y-2.5 text-slate-600 dark:text-slate-300">
              <li className="flex gap-2"><ShieldCheck className="h-5 w-5 shrink-0 text-brand-600" /> Simple document verification, quick approval</li>
              <li className="flex gap-2"><Wallet className="h-5 w-5 shrink-0 text-brand-600" /> Riders pay straight to your UPI or in cash</li>
              <li className="flex gap-2"><Clock className="h-5 w-5 shrink-0 text-brand-600" /> Go online / offline whenever you want</li>
              <li className="flex gap-2"><Star className="h-5 w-5 shrink-0 text-brand-600" /> Build your rating and get more rides</li>
            </ul>
            <Link to="/register" className="btn-primary mt-6 px-6 py-3">Register as a driver</Link>
          </div>
          <div className="card p-6">
            <p className="text-sm font-bold uppercase tracking-wide text-slate-400">A driver's week</p>
            <div className="mt-4 space-y-3">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => (
                <div key={d} className="flex items-center gap-3">
                  <span className="w-8 text-xs font-bold text-slate-400">{d}</span>
                  <div className="h-6 flex-1 overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
                    <div className="h-full rounded-lg bg-brand-500/80" style={{ width: `${35 + (i * 13) % 60}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-slate-400">Illustration only — your real earnings appear in your dashboard after rides.</p>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200 py-10 dark:border-slate-800">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-4 text-center">
          <div className="flex items-center gap-2"><LogoMark size={26} /><span className="font-extrabold">Sawaari</span></div>
          <p className="text-sm text-slate-500">Safe, transparent local auto travel. Made for Indian cities.</p>
          <p className="text-xs text-slate-400">© {new Date().getFullYear()} Sawaari. Maps © OpenStreetMap contributors.</p>
          <button onClick={() => setServerOpen(true)} className="link mt-1 flex items-center gap-1.5 text-xs text-slate-400">
            <Server className="h-3.5 w-3.5" /> Server settings
          </button>
        </div>
      </footer>

      <InstallPrompt />
    </div>
  );
}
