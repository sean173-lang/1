import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Plus, Minus, RotateCcw, Trophy, Image as ImageIcon, Sun, Moon, Cloud, Wifi, Link as LinkIcon, AlertTriangle } from "lucide-react";
import { createClient } from "@supabase/supabase-js";

/**
 * Hogwarts – Häuserpunkte (Online + Lokal)
 * -------------------------------------------------
 * 🔹 Lokal (Browser) **und** Online‑Backend (Supabase) zur gemeinsamen Nutzung
 * 🔹 Hintergrundbild kann hinzugefügt/entfernt werden (wird vor dem Speichern komprimiert)
 * 🔹 Punkte & Verlauf werden lokal gespeichert **und** optional in der Cloud synchronisiert
 * 🔹 Schutz vor "QuotaExceededError":
 *    - Verlauf wird auf max. 200 Einträge begrenzt
 *    - Hintergrund wird auf ~1600px skaliert & als JPEG (Qualität ~0.72) gespeichert
 *    - localStorage‑Schreibfehler werden abgefangen und im UI angezeigt
 *
 * 👉 Einmalige Supabase‑SQL:
 *   create table if not exists public.games (
 *     id text primary key,
 *     points jsonb not null,
 *     history jsonb not null,
 *     updated_at timestamptz not null default now()
 *   );
 *   alter table public.games enable row level security;
 *   create policy "public upsert" on public.games for insert with check (true);
 *   create policy "public update" on public.games for update using (true);
 *   create policy "public select" on public.games for select using (true);
 *
 * .env (z. B. in Vercel):
 *   NEXT_PUBLIC_SUPABASE_URL=... 
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
 */

// ====== Konstanten & Typen ======
const HOUSES = ["Gryffindor", "Slytherin", "Ravenclaw", "Hufflepuff"] as const;
type House = typeof HOUSES[number];

type PointsState = Record<House, number>;

type HistoryEntry = {
  id: string;
  house: House;
  delta: number; // + / - Punkte
  reason?: string;
  timestamp: number;
};

type Backend = "local" | "supabase";

type AppState = {
  points: PointsState;
  history: HistoryEntry[];
  theme: "light" | "dark";
  bgUrl: string; // komprimiertes data: URL (JPEG)
  room: string;  // geteilter Raum/Code
  backend: Backend; // gewähltes Backend
};

type NetStatus = "offline" | "online" | "syncing";

const LS_KEY = "hogwarts_points_hybrid_v1";
const MAX_HISTORY = 200;

// ====== ENV & Supabase ======
const SUPA_URL = (typeof process !== "undefined" && (process as any).env?.NEXT_PUBLIC_SUPABASE_URL) || "";
const SUPA_KEY = (typeof process !== "undefined" && (process as any).env?.NEXT_PUBLIC_SUPABASE_ANON_KEY) || "";
const supabase = SUPA_URL && SUPA_KEY ? createClient(SUPA_URL, SUPA_KEY) : null;
const supabaseReady = Boolean(supabase);

// ====== Utils ======
function uuid() {
  try { if (typeof crypto !== "undefined" && (crypto as any).randomUUID) return (crypto as any).randomUUID(); } catch {}
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
function clsx(...xs: (string | false | undefined)[]) { return xs.filter(Boolean).join(" "); }
function formatDate(ms: number) { return new Date(ms).toLocaleString(); }
function houseGradient(h: House) { switch (h) { case "Gryffindor": return "from-red-600 to-amber-700"; case "Slytherin": return "from-emerald-600 to-teal-700"; case "Ravenclaw": return "from-sky-600 to-indigo-700"; case "Hufflepuff": return "from-yellow-400 to-amber-500"; } }
function houseRing(h: House) { switch (h) { case "Gryffindor": return "ring-red-500"; case "Slytherin": return "ring-emerald-500"; case "Ravenclaw": return "ring-blue-500"; case "Hufflepuff": return "ring-yellow-400"; } }

function sanitizeRoom(s: string) { return (s || "").toLowerCase().replace(/[^a-z0-9_-]/gi, "").slice(0, 64) || "demo"; }
function getRoomFromURL(): string { try { if (typeof window === "undefined") return ""; const u = new URL(window.location.href); const r = u.searchParams.get("room"); return r ? sanitizeRoom(r) : ""; } catch { return ""; } }
function setRoomInURL(room: string) { try { if (typeof window === "undefined") return; const u = new URL(window.location.href); if (room) u.searchParams.set("room", room); else u.searchParams.delete("room"); window.history.replaceState({}, "", u.toString()); } catch {}
}

// Hintergrund verkleinern & als JPEG speichern
async function compressImageToDataUrl(file: File, maxDim = 1600, quality = 0.72): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.drawImage(bitmap, 0, 0, w, h);
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  return dataUrl;
}

// ====== Persistenz (lokal) ======
function readLocal(): AppState {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) throw new Error("no data");
    const data = JSON.parse(raw);
    const points: PointsState = data.points ?? { Gryffindor: 0, Slytherin: 0, Ravenclaw: 0, Hufflepuff: 0 };
    const history: HistoryEntry[] = Array.isArray(data.history) ? data.history.slice(0, MAX_HISTORY) : [];
    const theme: "light" | "dark" = data.theme === "light" ? "light" : "dark";
    const bgUrl: string = typeof data.bgUrl === "string" ? data.bgUrl : "";
    const room: string = sanitizeRoom(data.room || getRoomFromURL() || "demo");
    const backend: Backend = (data.backend as Backend) || (supabaseReady ? "supabase" : "local");
    return { points, history, theme, bgUrl, room, backend };
  } catch {
    return { points: { Gryffindor: 0, Slytherin: 0, Ravenclaw: 0, Hufflepuff: 0 }, history: [], theme: "dark", bgUrl: "", room: sanitizeRoom(getRoomFromURL() || "demo"), backend: (supabaseReady ? "supabase" : "local") };
  }
}

function writeLocal(state: AppState) {
  const toSave: AppState = {
    points: state.points,
    history: state.history.slice(0, MAX_HISTORY),
    theme: state.theme,
    bgUrl: state.bgUrl, // bereits komprimiert
    room: state.room,
    backend: state.backend,
  };
  const json = JSON.stringify(toSave);
  try {
    localStorage.setItem(LS_KEY, json);
  } catch (e) {
    // Schlucke Quota-Fehler; wird im UI angezeigt
    throw e;
  }
}

// ====== App ======
export default function HogwartsHousePointsHybrid() {
  const [state, setState] = useState<AppState>(readLocal());
  const { points, history, theme, bgUrl, room, backend } = state;

  const [house, setHouse] = useState<House>("Gryffindor");
  const [amount, setAmount] = useState<number>(5);
  const [reason, setReason] = useState<string>("");
  const [filter, setFilter] = useState<House | "Alle">("Alle");
  const [lsError, setLsError] = useState<string>("");
  const [net, setNet] = useState<NetStatus>("offline");

  const bgRef = useRef<HTMLInputElement | null>(null);
  const lastRemoteRef = useRef<string | null>(null);

  const effectiveBackend: Backend = useMemo(() => {
    if (backend === "supabase" && !supabaseReady) return "local";
    return backend;
  }, [backend]);

  // Schreiben nach localStorage (mit Fehleranzeige)
  useEffect(() => {
    try {
      writeLocal(state);
      if (lsError) setLsError("");
    } catch (e: any) {
      setLsError(e?.message || String(e));
    }
  }, [state]);

  // Initial-Load aus Supabase (wenn aktiv)
  useEffect(() => {
    (async () => {
      if (effectiveBackend !== "supabase" || !supabaseReady || !supabase) { setNet("offline"); return; }
      if (!room) return;
      setNet("syncing");
      const { data, error } = await (supabase as any)
        .from("games")
        .select("id, points, history, updated_at")
        .eq("id", room)
        .single();
      if (!error && data) {
        setState((p) => ({ ...p, points: data.points as PointsState, history: (data.history as HistoryEntry[]).slice(0, MAX_HISTORY) }));
        lastRemoteRef.current = data.updated_at as string;
      }
      setNet("online");
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, effectiveBackend]);

  // Realtime-Subscription (Supabase)
  useEffect(() => {
    if (effectiveBackend !== "supabase" || !supabaseReady || !supabase || !room) return;
    const channel = (supabase as any)
      .channel(`games-room-${room}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'games', filter: `id=eq.${room}` }, (payload: any) => {
        const remote = payload?.new; if (!remote) return;
        if (!lastRemoteRef.current || new Date(remote.updated_at) > new Date(lastRemoteRef.current)) {
          setState((prev) => ({ ...prev, points: remote.points as PointsState, history: (remote.history as HistoryEntry[]).slice(0, MAX_HISTORY) }));
          lastRemoteRef.current = remote.updated_at as string;
        }
      })
      .subscribe();
    return () => { try { (supabase as any).removeChannel(channel); } catch {} };
  }, [effectiveBackend, room]);

  // Debounced Upsert zu Supabase
  useEffect(() => {
    if (effectiveBackend !== "supabase" || !supabaseReady || !supabase || !room) return;
    const t = setTimeout(async () => {
      setNet("syncing");
      await (supabase as any)
        .from("games")
        .upsert({ id: room, points, history, updated_at: new Date().toISOString() }, { onConflict: "id" });
      lastRemoteRef.current = new Date().toISOString();
      setNet("online");
    }, 400);
    return () => { clearTimeout(t); };
  }, [points, history, effectiveBackend, room]);

  // Leaderboard & Summen
  const total = useMemo(() => Object.values(points).reduce((a, b) => a + b, 0), [points]);
  const leader = useMemo(() => {
    const entries = Object.entries(points) as [House, number][];
    const max = Math.max(...entries.map(([, v]) => v));
    const top = entries.filter(([, v]) => v === max).map(([h]) => h);
    return { max, top };
  }, [points]);

  // Aktionen
  function applyDelta(target: House, delta: number, why?: string) {
    setState((prev) => {
      const nextPoints: PointsState = { ...prev.points, [target]: prev.points[target] + delta };
      const entry: HistoryEntry = { id: uuid(), house: target, delta, reason: (why || "").trim() || undefined, timestamp: Date.now() };
      const nextHistory = [entry, ...prev.history].slice(0, MAX_HISTORY);
      return { ...prev, points: nextPoints, history: nextHistory };
    });
  }
  function onAdd(sign: 1 | -1) {
    const amt = Number.isFinite(amount) ? Math.floor(Math.abs(amount)) : 0; if (!amt) return;
    applyDelta(house, sign * amt, reason); setReason("");
  }
  function resetAll() {
    if (!confirm("Alle Punkte & Verlauf wirklich zurücksetzen?")) return;
    setState((prev) => ({ ...prev, points: { Gryffindor: 0, Slytherin: 0, Ravenclaw: 0, Hufflepuff: 0 }, history: [] }));
  }

  // Hintergrund setzen/entfernen
  async function onPickBackground(file: File) {
    try {
      const dataUrl = await compressImageToDataUrl(file, 1600, 0.72);
      setState((prev) => ({ ...prev, bgUrl: dataUrl }));
    } catch (e: any) {
      alert(`Hintergrund konnte nicht verarbeitet werden: ${e?.message || e}`);
    }
  }
  function removeBackground() {
    setState((prev) => ({ ...prev, bgUrl: "" }));
  }

  // 🔬 Mini-Tests (zur Laufzeit; ändern nichts)
  useEffect(() => {
    try {
      const s: PointsState = { Gryffindor: 1, Slytherin: 2, Ravenclaw: 3, Hufflepuff: 4 };
      console.assert(Object.values(s).reduce((a,b)=>a+b,0) === 10, "Summenberechnung inkorrekt");
      console.assert(sanitizeRoom("  KLasse7A !!!  ") === "klasse7a", "sanitizeRoom fehlgeschlagen");
      console.assert(MAX_HISTORY === 200, "Erwartete History-Länge 200");
    } catch {}
  }, []);

  return (
    <div
      className={clsx(
        "min-h-screen w-full transition-colors",
        theme === "dark" ? "bg-slate-950 text-slate-50" : "bg-slate-100 text-slate-900"
      )}
      style={{
        backgroundImage: bgUrl ? `linear-gradient(rgba(2,6,23,0.55), rgba(2,6,23,0.55)), url(${bgUrl})` : undefined,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <div className="mx-auto max-w-6xl px-4 pb-20 pt-8">
        {/* Fehlerbanner */}
        {lsError && (
          <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/15 px-3 py-2 text-sm text-amber-200">
            Speicher ist voll (localStorage): {lsError}. Tipp: kleineres Hintergrundbild wählen oder den Verlauf zurücksetzen.
          </div>
        )}

        {/* Header */}
        <motion.header initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
          <div className={clsx("rounded-3xl border p-4 sm:p-6", theme === "dark" ? "border-slate-800 bg-slate-900/70" : "border-slate-300 bg-white/70 backdrop-blur") }>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h1 className="text-2xl font-extrabold tracking-tight">Hogwarts – Häuserpunkte</h1>
                <p className={clsx("text-sm", theme === "dark" ? "text-slate-300" : "text-slate-600")}>Lokal & Online (Supabase). Teile einen <b>Raum‑Code</b> und synchronisiere mit allen.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => setState((p)=>({ ...p, theme: p.theme === "dark" ? "light" : "dark" }))} className={clsx("inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm", theme === "dark" ? "bg-slate-800 border border-slate-700 hover:bg-slate-700" : "bg-white border border-slate-300 hover:bg-slate-100")}>
                  {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}Theme
                </button>
                <button onClick={() => (bgRef.current?.click())} className={clsx("inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm", theme === "dark" ? "bg-slate-800 border border-slate-700 hover:bg-slate-700" : "bg-white border border-slate-300 hover:bg-slate-100")}>
                  <ImageIcon className="h-4 w-4"/> Hintergrund wählen
                </button>
                {bgUrl && (
                  <button onClick={removeBackground} className={clsx("inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm", theme === "dark" ? "bg-slate-800 border border-slate-700 hover:bg-slate-700" : "bg-white border border-slate-300 hover:bg-slate-100")}>
                    Hintergrund entfernen
                  </button>
                )}
                <input ref={bgRef} type="file" accept="image/*" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) await onPickBackground(f); e.currentTarget.value = ""; }} />
              </div>
            </div>

            {/* Backend/Room */}
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="flex items-center gap-2">
                <span className="text-xs opacity-70">Backend</span>
                <div className="ml-2 inline-flex overflow-hidden rounded-xl border">
                  <button className={clsx("px-3 py-1 text-sm", state.backend === "local" ? "bg-slate-800 text-white" : "bg-transparent")} onClick={() => setState((p)=>({ ...p, backend: "local" }))}>Lokal</button>
                  <button className={clsx("px-3 py-1 text-sm", state.backend === "supabase" ? "bg-slate-800 text-white" : "bg-transparent", !supabaseReady && "opacity-50 cursor-not-allowed")} onClick={() => setState((p)=>({ ...p, backend: "supabase" }))} title={supabaseReady ? "Supabase nutzen" : "ENV fehlt"}>Supabase</button>
                </div>
              </div>

              <div className="flex items-center gap-2 md:col-span-2">
                <span className="text-xs opacity-70">Raum</span>
                <input value={room} onChange={(e) => setState((p) => ({ ...p, room: sanitizeRoom(e.target.value) }))} placeholder="z.B. klasse7a" className="flex-1 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm" />
                <button onClick={() => { const r = sanitizeRoom(state.room); setState((p)=>({ ...p, room: r })); setRoomInURL(r); }} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-medium hover:bg-emerald-500">
                  <LinkIcon className="h-4 w-4" /> Verbinden
                </button>
                {effectiveBackend === "supabase" && (
                  <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-black/20 px-2 py-1 text-xs">
                    <Cloud className="h-3 w-3" /> {net === "syncing" ? "Sync…" : net === "online" ? "Online" : "Offline"}
                  </span>
                )}
                {!supabaseReady && state.backend === "supabase" && (
                  <span className="ml-2 inline-flex items-center gap-1 text-xs text-amber-300"><AlertTriangle className="h-3 w-3"/> ENV fehlt</span>
                )}
              </div>
            </div>

            {/* Leader-Zeile */}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-black/20 px-2 py-1">Gesamt: <b>{total}</b></span>
              <span className="rounded-full bg-black/20 px-2 py-1">Aktionen: <b>{history.length}</b></span>
              {leader.top.length === 1 ? (
                <span className="rounded-full bg-black/20 px-2 py-1">Spitzenreiter: <b>{leader.top[0]}</b> ({leader.max})</span>
              ) : (
                <span className="rounded-full bg-black/20 px-2 py-1">Gleichstand: {leader.top.join(", ")} ({leader.max})</span>
              )}
            </div>
          </div>
        </motion.header>

        {/* Houses */}
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {HOUSES.map((h) => {
            const val = points[h];
            const pct = total > 0 ? Math.round((val / total) * 100) : 0;
            return (
              <motion.div key={h} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                <div className={clsx("relative overflow-hidden rounded-2xl p-[1px] ring-2", houseRing(h))}>
                  <div className={clsx("rounded-2xl bg-gradient-to-b p-4", houseGradient(h))}>
                    <div className={clsx("rounded-xl p-4 backdrop-blur shadow-lg", theme === "dark" ? "bg-black/30" : "bg-white/40") }>
                      <div className="mb-2 flex items-center justify-between text-white/90">
                        <div className="text-sm uppercase tracking-wider">{h}</div>
                        <div className="text-xs opacity-90">{pct}%</div>
                      </div>
                      <div className="mb-3 flex items-end gap-2">
                        <div className="text-4xl font-black leading-none drop-shadow">{val}</div>
                        <div className="text-xs opacity-90">Punkte</div>
                      </div>
                      <div className={clsx("mb-4 h-2 w-full overflow-hidden rounded-full", theme === "dark" ? "bg-white/20" : "bg-black/10")}> <div className="h-full bg-white/80" style={{ width: `${pct}%` }} /></div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => applyDelta(h, +5, "Schnellaktion")} className="inline-flex items-center gap-2 rounded-xl bg-white/20 px-3 py-2 text-sm hover:bg-white/30"><Plus className="h-4 w-4" /> +5</button>
                        <button onClick={() => applyDelta(h, -5, "Schnellaktion")} className="inline-flex items-center gap-2 rounded-xl bg-white/20 px-3 py-2 text-sm hover:bg-white/30"><Minus className="h-4 w-4" /> -5</button>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Controls */}
        <div className={clsx("mb-6 rounded-2xl border p-5", theme === "dark" ? "border-slate-800 bg-slate-900/70" : "border-slate-300 bg-white/70 backdrop-blur") }>
          <h2 className="mb-3 text-lg font-semibold">Aktion</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <label className="flex flex-col gap-2">
              <span className="text-sm opacity-80">Haus</span>
              <select className={clsx("rounded-xl px-3 py-2", theme === "dark" ? "border border-slate-700 bg-slate-800" : "border border-slate-300 bg-white")} value={house} onChange={(e) => setHouse(e.target.value as House)}>
                {HOUSES.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-2">
              <span className="text-sm opacity-80">Punkte</span>
              <input type="number" min={1} step={1} value={amount} onChange={(e) => setAmount(parseInt(e.target.value || "0", 10))} className={clsx("rounded-xl px-3 py-2", theme === "dark" ? "border border-slate-700 bg-slate-800" : "border border-slate-300 bg-white")} />
            </label>
            <label className="col-span-1 sm:col-span-2 flex flex-col gap-2">
              <span className="text-sm opacity-80">Grund (optional)</span>
              <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="z.B. Hausaufgabe vergessen / Mut bewiesen" className={clsx("rounded-xl px-3 py-2", theme === "dark" ? "border border-slate-700 bg-slate-800" : "border border-slate-300 bg-white")} />
            </label>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button onClick={() => onAdd(1)} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium hover:bg-emerald-500"><Plus className="h-4 w-4" /> Punkte hinzufügen</button>
            <button onClick={() => onAdd(-1)} className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-medium hover:bg-red-500"><Minus className="h-4 w-4" /> Punkte abziehen</button>
            <button onClick={resetAll} className="ml-auto inline-flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm hover:bg-red-500/20"><RotateCcw className="h-4 w-4"/> Reset</button>
          </div>
        </div>

        {/* Verlauf */}
        <div className={clsx("rounded-2xl border p-5", theme === "dark" ? "border-slate-800 bg-slate-900/70" : "border-slate-300 bg-white/70 backdrop-blur") }>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Verlauf</h2>
            <select className={clsx("rounded-xl px-3 py-1 text-sm", theme === "dark" ? "border border-slate-700 bg-slate-800" : "border border-slate-300 bg-white")} value={filter} onChange={(e)=>setFilter(e.target.value as any)}>
              <option value="Alle">Alle Häuser</option>
              {HOUSES.map((h)=> <option key={h} value={h}>{h}</option>)}
            </select>
          </div>
          {(filter === "Alle" ? history : history.filter((x)=>x.house===filter)).length === 0 ? (
            <div className={clsx(theme === "dark" ? "text-slate-400" : "text-slate-600")}>Noch keine Aktionen. Lege los!</div>
          ) : (
            <ul className="divide-y divide-slate-800/40">
              {(filter === "Alle" ? history : history.filter((x)=>x.house===filter)).map((h) => (
                <li key={h.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <span className={clsx("inline-flex min-w-[72px] justify-center rounded-full px-3 py-1 text-sm font-medium", h.delta >= 0 ? "bg-emerald-600/20 text-emerald-300" : "bg-red-600/20 text-red-300")}>{h.delta >= 0 ? `+${h.delta}` : h.delta}</span>
                    <div>
                      <div className="text-sm"><b>{h.house}</b>{h.reason ? <span className={clsx(theme === "dark" ? "text-slate-300" : "text-slate-700")}> — {h.reason}</span> : null}</div>
                      <div className={clsx("text-xs", theme === "dark" ? "text-slate-400" : "text-slate-600")}>{formatDate(h.timestamp)}</div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className={clsx("mt-8 text-center text-xs", theme === "dark" ? "text-slate-500" : "text-slate-600")}>© {new Date().getFullYear()} Hauspunkte-Tracker (Hybrid)</footer>
      </div>
    </div>
  );
}
