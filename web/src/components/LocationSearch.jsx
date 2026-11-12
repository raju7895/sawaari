import { useEffect, useRef, useState } from 'react';
import { MapPin, Loader2, LocateFixed, Search } from 'lucide-react';
import { api } from '../api';
import { useToast } from '../context/ToastContext';

/**
 * Location autocomplete powered by server-side Nominatim geocoding,
 * plus "use my current location" via browser geolocation.
 * value: {lat, lng, address} | null
 */
export default function LocationSearch({
  value, onChange, placeholder = 'Search a place…', near, icon, autoFocus, compact,
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const debounceRef = useRef(null);
  const boxRef = useRef(null);
  const { toast } = useToast();

  useEffect(() => {
    const onClick = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const search = (query) => {
    clearTimeout(debounceRef.current);
    if (query.trim().length < 3) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ q: query.trim() });
        if (near) { params.set('lat', near[0]); params.set('lng', near[1]); }
        const res = await api.get(`/api/geo/search?${params}`);
        setResults(res);
        setOpen(true);
      } catch (err) {
        toast(err.message, 'error');
      } finally { setLoading(false); }
    }, 450);
  };

  const useCurrentLocation = () => {
    if (!navigator.geolocation) return toast('Geolocation is not supported by this browser', 'error');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const rev = await api.get(`/api/geo/reverse?lat=${pos.coords.latitude}&lng=${pos.coords.longitude}`);
          onChange({
            lat: pos.coords.latitude, lng: pos.coords.longitude,
            address: rev?.label || rev?.secondary || 'Current location',
          });
          setQ('');
          setOpen(false);
        } catch (err) {
          toast(err.message, 'error');
        } finally { setLocating(false); }
      },
      (err) => {
        setLocating(false);
        toast(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission denied — allow it in your browser or search manually.'
            : 'Could not get your location. Try searching instead.',
          'error'
        );
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  return (
    <div ref={boxRef} className="relative">
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
          {icon || <Search className="h-4 w-4" />}
        </span>
        <input
          className={`input pl-9 ${compact ? 'py-2' : ''} ${value ? 'pr-9' : ''}`}
          value={q}
          autoFocus={autoFocus}
          placeholder={placeholder}
          onChange={(e) => { setQ(e.target.value); search(e.target.value); }}
          onFocus={() => { if (results.length) setOpen(true); }}
        />
        {value && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500">
            <MapPin className="h-4 w-4" />
          </span>
        )}
      </div>

      {open && (
        <div className="absolute z-30 mt-1.5 max-h-72 w-full overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <button
            className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm font-medium text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-slate-800"
            onClick={() => { useCurrentLocation(); }}
          >
            {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />}
            Use my current location
          </button>
          {loading && (
            <div className="flex items-center gap-2 px-3.5 py-2.5 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Searching places…
            </div>
          )}
          {results.map((r, i) => (
            <button
              key={i}
              className="flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
              onClick={() => {
                onChange({ lat: r.lat, lng: r.lng, address: r.secondary || r.label });
                setQ(''); setOpen(false); setResults([]);
              }}
            >
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <span>
                <span className="block text-sm font-medium">{r.label}</span>
                <span className="block truncate text-xs text-slate-500">{r.secondary}</span>
              </span>
            </button>
          ))}
          {!loading && q.trim().length >= 3 && !results.length && (
            <div className="px-3.5 py-2.5 text-sm text-slate-500">No places found. Try a different spelling.</div>
          )}
        </div>
      )}

      {value && !q && (
        <div className="mt-1.5 flex items-start gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600" />
          <span className="line-clamp-1">{value.address}</span>
        </div>
      )}
    </div>
  );
}
