import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { STRUCTURE_BY_KEY, type BiomeScale, type Pos, type StructureKey } from "@seedscout/engine";
import { pool } from "../engine/pool";
import type { World } from "../engine/protocol";

export interface MapMarker extends Pos {
  key: StructureKey | "spawn" | "stronghold";
}

export interface MapHandle {
  flyTo(p: Pos, zoom?: number): void;
  zoomBy(d: number): void;
}

interface Props {
  world: World;
  structures: StructureKey[];
  onSelect(m: MapMarker): void;
  onCenter(p: Pos, zoom: number): void;
  onReady(h: MapHandle): void;
}

/** 1 map unit = 1 block. lat = z grows downward (south), lng = x grows right (east), like Minecraft. */
const CRS = L.extend({}, L.CRS.Simple, { transformation: new L.Transformation(1, 0, 1, 0) });
const ll = (p: Pos) => L.latLng(p.z, p.x);

const TILE = 256;
/** Structures are only fetched when zoomed in enough for markers to be meaningful. */
const STRUCTURE_MIN_ZOOM = -3;

/** Picks the cubiomes sampling scale so every tile costs at most 64x64 samples. */
function tileParams(zoom: number, tx: number, ty: number) {
  const span = TILE * 2 ** -zoom; // blocks per tile edge
  const scale = ([4, 16, 64, 256] as const).find((s) => span / s <= 64) ?? 256;
  const n = Math.max(1, span / scale);
  return { scale: scale as BiomeScale, n, x: (tx * span) / scale, z: (ty * span) / scale };
}

class BiomeLayer extends L.GridLayer {
  world!: World;
  generation = 0;
  private scratch = new Map<number, HTMLCanvasElement>();

  createTile(coords: L.Coords, done: L.DoneCallback): HTMLElement {
    const tile = document.createElement("canvas");
    tile.width = tile.height = TILE;
    const { scale, n, x, z } = tileParams(coords.z, coords.x, coords.y);
    const key = `tile:${this.generation}:${coords.x}:${coords.y}:${coords.z}`;
    (tile as HTMLCanvasElement & { _key?: string })._key = key;
    pool
      .request("tile", { world: this.world, scale, x, z, n }, { key, background: true })
      .then((rgba) => {
        let small = this.scratch.get(n);
        if (!small) this.scratch.set(n, (small = Object.assign(document.createElement("canvas"), { width: n, height: n })));
        small.getContext("2d")!.putImageData(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, n, n), 0, 0);
        const ctx = tile.getContext("2d")!;
        ctx.imageSmoothingEnabled = false; // crisp biome cells
        ctx.drawImage(small, 0, 0, TILE, TILE);
        done(undefined, tile);
      })
      .catch((err) => done(err, tile));
    return tile;
  }
}

function markerIcon(m: MapMarker): L.DivIcon {
  const glyph = m.key === "spawn" ? "⭐" : m.key === "stronghold" ? "👁️" : STRUCTURE_BY_KEY[m.key].icon;
  // 44px hit target per mobile guidelines; the glyph itself is smaller.
  return L.divIcon({ className: `marker marker-${m.key}`, html: `<span>${glyph}</span>`, iconSize: [44, 44] });
}

export function MapView({ world, structures, onSelect, onCenter, onReady }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map>(null);
  const biomes = useRef<BiomeLayer>(null);
  const markers = useRef<L.LayerGroup>(null);
  const markerIndex = useRef(new Map<string, L.Marker>());
  const props = useRef({ world, structures, onSelect, onCenter });
  props.current = { world, structures, onSelect, onCenter };

  // Create the map once.
  useEffect(() => {
    const map = L.map(el.current!, {
      crs: CRS,
      center: [0, 0],
      zoom: -1,
      minZoom: -6,
      maxZoom: 3,
      zoomControl: false, // custom, thumb-sized controls instead
      attributionControl: false,
      bounceAtZoomLimits: false,
      zoomSnap: 1,
      wheelPxPerZoomLevel: 90,
      tapTolerance: 20,
    });
    // GridLayer defaults to minZoom 0; our zoomed-out levels are negative.
    const layer = new BiomeLayer({ tileSize: TILE, minZoom: -6, maxZoom: 3, keepBuffer: 1, updateWhenZooming: false });
    layer.world = props.current.world;
    layer.on("tileunload", (e) => {
      const key = (e.tile as unknown as { _key?: string })._key;
      if (key) pool.cancel((k) => k === key);
    });
    layer.addTo(map);
    const group = L.layerGroup().addTo(map);

    let raf = 0;
    map.on("move", () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const c = map.getCenter();
        props.current.onCenter({ x: Math.round(c.lng), z: Math.round(c.lat) }, map.getZoom());
      });
    });
    map.on("moveend", () => refreshStructures());

    mapRef.current = map;
    biomes.current = layer;
    markers.current = group;
    onReady({
      flyTo: (p, zoom) => map.flyTo(ll(p), zoom ?? Math.max(map.getZoom(), 0), { duration: 0.6 }),
      zoomBy: (d) => map.setZoom(map.getZoom() + d),
    });
    return () => {
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Fetches structures for the visible area and diffs them into the marker layer. */
  async function refreshStructures() {
    const map = mapRef.current, group = markers.current;
    if (!map || !group) return;
    const { world, structures } = props.current;
    const pinned = new Set(["spawn", "stronghold"]);
    const drop = (keep: (id: string) => boolean) => {
      for (const [id, m] of markerIndex.current) if (!keep(id)) (group.removeLayer(m), markerIndex.current.delete(id));
    };
    if (map.getZoom() < STRUCTURE_MIN_ZOOM || !structures.length) return drop((id) => pinned.has(id.split(":")[0]!));

    const b = map.getBounds().pad(0.25);
    // Our CRS flips lat so z grows southward; Leaflet's "north" is therefore the larger z.
    const zs = [b.getNorth(), b.getSouth()];
    const box: [number, number, number, number] = [Math.floor(b.getWest()), Math.floor(Math.min(...zs)), Math.ceil(b.getEast()), Math.ceil(Math.max(...zs))];
    const found = await pool.request("structures", { world, keys: structures, box });
    if (props.current.world !== world) return; // seed changed while we were computing
    const want = new Set(found.map((s) => `${s.key}:${s.x}:${s.z}`));
    drop((id) => want.has(id) || pinned.has(id.split(":")[0]!));
    for (const s of found) addMarker(s);
  }

  function addMarker(m: MapMarker) {
    const id = `${m.key}:${m.x}:${m.z}`;
    if (markerIndex.current.has(id)) return;
    const marker = L.marker(ll(m), { icon: markerIcon(m), keyboard: true, title: m.key }).on("click", () => props.current.onSelect(m));
    markerIndex.current.set(id, marker);
    markers.current!.addLayer(marker);
  }

  // Seed / version changed: cancel stale tiles, redraw, reset markers, recentre on spawn.
  useEffect(() => {
    const layer = biomes.current, map = mapRef.current;
    if (!layer || !map) return;
    layer.generation++;
    layer.world = world;
    pool.cancel((k) => k.startsWith("tile:"));
    layer.redraw();
    markers.current!.clearLayers();
    markerIndex.current.clear();
    let live = true;
    pool.request("overview", { world }).then(({ spawn, strongholds }) => {
      if (!live) return;
      addMarker({ key: "spawn", ...spawn });
      strongholds.forEach((p) => addMarker({ key: "stronghold", ...p }));
      map.setView(ll(spawn), map.getZoom(), { animate: false });
      refreshStructures();
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world]);

  useEffect(() => {
    refreshStructures();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structures]);

  return <div ref={el} className="map" role="application" aria-label="Seed map. Drag to pan, pinch to zoom." />;
}
