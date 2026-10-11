import { STRUCTURES, type StructureKey } from "@seedscout/engine";

export function LayersPanel({ enabled, onChange }: { enabled: StructureKey[]; onChange(k: StructureKey[]): void }) {
  const toggle = (k: StructureKey) => onChange(enabled.includes(k) ? enabled.filter((e) => e !== k) : [...enabled, k]);
  return (
    <div className="panel">
      <p className="muted small">Structures appear when you zoom in. Tap a marker for coordinates and loot.</p>
      <div className="chips">
        {STRUCTURES.map((s) => (
          <button key={s.key} className="chip" aria-pressed={enabled.includes(s.key)} onClick={() => toggle(s.key)}>
            <span>{s.icon}</span> {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
