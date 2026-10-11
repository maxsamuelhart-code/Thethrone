import { Engine } from "@seedscout/engine";
import wasm from "@seedscout/engine/wasm/cubiomes.wasm";

// One engine per isolate, reused across requests.
let engine: Promise<Engine> | undefined;
export const getEngine = () => (engine ??= Engine.load(wasm));
