import { useCallback, useEffect, useRef, useState } from "react";
import { isVersion, LATEST_VERSION, parseSeed, VERSION_LIST, type McVersion, type Pos, type StructureKey } from "@seedscout/engine";
import { can, type Feature, type Me } from "@seedscout/shared";
import { MapView, type MapHandle, type MapMarker } from "./map/MapView";
import { Sheet, type SheetState } from "./components/Sheet";
import { ScorePanel } from "./components/ScorePanel";
import { DetailPanel } from "./components/DetailPanel";
import { LayersPanel } from "./components/LayersPanel";
import { SearchPanel } from "./components/SearchPanel";
import { SavedPanel } from "./components/SavedPanel";
import { AccountModal, LoginModal, UpgradeModal } from "./components/Modals";
import { ANON, ApiError, fetchMe } from "./api";
import type { World } from "./engine/protocol";

type Tab = "score" | "layers" | "search" | "saved" | "detail";
const TABS: Array<{ id: Tab; label: string; pro?: Feature }> = [
  { id: "score", label: "Score" },
  { id: "layers", label: "Map" },
  { id: "search", label: "Search", pro: "search" },
  { id: "saved", label: "Saved", pro: "saved" },
];
const DEFAULT_STRUCTURES: StructureKey[] = ["village", "desert_pyramid", "jungle_temple", "outpost", "ruined_portal", "shipwreck", "buried_treasure", "monument", "mansion", "ancient_city", "trial_chambers"];

function initialWorld(): { text: string; world: World } {
  const q = new URLSearchParams(location.search);
  const text = q.get("seed") ?? String(Math.floor(Math.random() * 2 ** 31));
  const v = q.get("v");
  return { text, world: { seed: parseSeed(text), version: isVersion(v) ? v : LATEST_VERSION } };
}

export function App() {
  const init = useRef(initialWorld()).current;
  const [seedText, setSeedText] = useState(init.text);
  const [world, setWorld] = useState<World>(init.world);
  const [me, setMe] = useState<Me>(ANON);
  const [tab, setTab] = useState<Tab>("score");
  const [sheet, setSheet] = useState<SheetState>("peek");
  const [selected, setSelected] = useState<MapMarker | null>(null);
  const [structures, setStructures] = useState<StructureKey[]>(DEFAULT_STRUCTURES);
  const [center, setCenter] = useState<Pos>({ x: 0, z: 0 });
  const [modal, setModal] = useState<{ kind: "upgrade"; feature?: Feature } | { kind: "login" } | { kind: "account" } | null>(null);
  const map = useRef<MapHandle>(null);

  useEffect(() => {
    fetchMe().then(setMe);
  }, []);

  // Shareable URL for the current seed.
  useEffect(() => {
    const q = new URLSearchParams({ seed: world.seed.toString(), v: world.version });
    history.replaceState(null, "", `?${q}`);
  }, [world]);

  const openSeed = useCallback((text: string, version: McVersion = world.version) => {
    setSeedText(text);
    setWorld({ seed: parseSeed(text), version });
    setSelected(null);
    setTab("score");
  }, [world.version]);

  const isPro = me.plan === "pro";
  const upgrade = (feature?: Feature) => setModal({ kind: "upgrade", feature });
  const onApiError = (e: ApiError) => (e.status === 401 ? setModal({ kind: "login" }) : e.status === 402 ? upgrade(e.feature) : alert(e.message));

  return (
    <div className={`app with-sheet-${sheet}`}>
      <MapView
        world={world}
        structures={structures}
        onReady={(h) => (map.current = h)}
        onCenter={setCenter}
        onSelect={(m) => {
          setSelected(m);
          setTab("detail");
          setSheet("half");
        }}
      />
      <div className="crosshair" aria-hidden />

      <header className="topbar">
        <form
          className="seed-form"
          onSubmit={(e) => {
            e.preventDefault();
            (document.activeElement as HTMLElement)?.blur(); // dismiss mobile keyboard
            openSeed(seedText);
          }}
        >
          <input
            aria-label="Seed"
            value={seedText}
            onChange={(e) => setSeedText(e.target.value)}
            enterKeyHint="go"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Enter a seed"
          />
          <select aria-label="Version" value={world.version} onChange={(e) => setWorld({ ...world, version: e.target.value as McVersion })}>
            {VERSION_LIST.slice().reverse().map((v) => <option key={v}>{v}</option>)}
          </select>
          <button type="button" className="icon-btn" aria-label="Random seed" onClick={() => openSeed(String(Math.floor(Math.random() * 2 ** 31)))}>🎲</button>
        </form>
        <button className="icon-btn account" aria-label="Account" onClick={() => setModal(me.user ? { kind: "account" } : { kind: "login" })}>
          {me.user ? (isPro ? "⭐" : "👤") : "Sign in"}
        </button>
      </header>

      <div className="coords-pill" aria-live="polite">X {center.x} · Z {center.z}</div>

      <div className="fabs">
        <button className="fab" aria-label="Zoom in" onClick={() => map.current?.zoomBy(1)}>+</button>
        <button className="fab" aria-label="Zoom out" onClick={() => map.current?.zoomBy(-1)}>−</button>
      </div>

      <Sheet
        state={sheet}
        onState={setSheet}
        header={
          <nav className="tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => {
                  setTab(t.id);
                  if (sheet === "peek") setSheet("half");
                }}
              >
                {t.label}
                {t.pro && !can(me.plan, t.pro) && <span className="pro-dot" aria-label="Pro" />}
              </button>
            ))}
          </nav>
        }
      >
        {tab === "score" && <ScorePanel world={world} onGo={(p) => map.current?.flyTo(p)} />}
        {tab === "layers" && <LayersPanel enabled={structures} onChange={setStructures} />}
        {tab === "detail" && selected && (
          <DetailPanel world={world} marker={selected} isPro={isPro} onUpgrade={() => upgrade("loot")} onAuthError={onApiError} />
        )}
        {tab === "search" && (
          <SearchPanel world={world} isPro={isPro} onUpgrade={() => upgrade("search")} onAuthError={onApiError} onOpenSeed={(s) => openSeed(s)} />
        )}
        {tab === "saved" && (
          <SavedPanel world={world} isPro={isPro} onUpgrade={() => upgrade("saved")} onAuthError={onApiError} onOpen={(s) => openSeed(s.seed, s.version)} />
        )}
      </Sheet>

      {modal?.kind === "upgrade" && <UpgradeModal me={me} feature={modal.feature} onClose={() => setModal(null)} onLogin={() => setModal({ kind: "login" })} />}
      {modal?.kind === "login" && <LoginModal onClose={() => setModal(null)} />}
      {modal?.kind === "account" && <AccountModal me={me} onClose={() => setModal(null)} />}
    </div>
  );
}
