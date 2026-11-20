import { reduceColors, type ColorCount } from "./quantize";

interface Request {
  id: number;
  hist: ColorCount[];
  keepCount: number;
}

self.onmessage = (e: MessageEvent<Request>) => {
  const { id, hist, keepCount } = e.data;
  const result = reduceColors(hist, keepCount, (fraction) => {
    self.postMessage({ id, type: "progress", fraction });
  });
  self.postMessage({ id, type: "done", kept: result.kept, map: result.map });
};
