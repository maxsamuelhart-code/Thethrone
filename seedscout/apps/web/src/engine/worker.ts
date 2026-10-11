/// <reference lib="webworker" />
import { Engine, LATEST_VERSION, scoreSeed, STRUCTURE_BY_KEY } from "@seedscout/engine";
import wasmUrl from "@seedscout/engine/wasm/cubiomes.wasm?url";
import type { Responses, WorkerRequest, WorkerResponse } from "./protocol";

const engineReady = (async () => {
  const res = fetch(wasmUrl);
  const module = await WebAssembly.compileStreaming(res).catch(async () => new WebAssembly.Module(await (await fetch(wasmUrl)).arrayBuffer()));
  return Engine.load(module);
})();

function handle(engine: Engine, req: WorkerRequest): { result: Responses[typeof req.type]; transfer?: Transferable[] } {
  switch (req.type) {
    case "tile": {
      const { world, scale, x, z, n } = req.payload;
      engine.setWorld(world);
      const rgba = engine.biomeRgba(scale, x, z, n, n);
      return { result: rgba, transfer: [rgba.buffer] };
    }
    case "structures": {
      const { world, keys, box } = req.payload;
      engine.setWorld(world);
      return { result: keys.flatMap((key) => engine.structuresInBox(STRUCTURE_BY_KEY[key].type, ...box).map((p) => ({ key, ...p }))) };
    }
    case "overview":
      engine.setWorld(req.payload.world);
      return { result: { spawn: engine.spawn(true), strongholds: engine.strongholds(3) } };
    case "score":
      return { result: scoreSeed(engine, req.payload.world, req.payload.profile) };
    case "biomeAt": {
      const { world, x, z } = req.payload;
      engine.setWorld(world);
      return { result: engine.biomeName(engine.biomeAt(x, z)) };
    }
    case "biomeList":
      engine.setWorld({ seed: 0n, version: req.payload.version ?? LATEST_VERSION });
      return { result: engine.biomeList() };
  }
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  try {
    const { result, transfer } = handle(await engineReady, req);
    self.postMessage({ id: req.id, ok: true, result } satisfies WorkerResponse, { transfer: transfer ?? [] });
  } catch (err) {
    self.postMessage({ id: req.id, ok: false, error: String(err) } satisfies WorkerResponse);
  }
};
