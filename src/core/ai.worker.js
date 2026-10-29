// Web Worker wrapper around the AI planner so thinking never blocks rendering.
import { planMatchShot, decidePush } from './ai.js';

self.onmessage = (e) => {
  const { id, kind, input } = e.data;
  try {
    const result = kind === 'push' ? decidePush(input) : planMatchShot(input);
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.stack ? err.stack : err) });
  }
};
