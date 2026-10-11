import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Engine } from "../src/engine";

export const loadEngine = () => Engine.load(readFileSync(fileURLToPath(new URL("../wasm/cubiomes.wasm", import.meta.url))));
