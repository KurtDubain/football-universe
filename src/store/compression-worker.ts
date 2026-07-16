import { compressToUTF16 } from 'lz-string';

export interface CompressionWorkerRequest {
  name: string;
  revision: number;
  payload: unknown;
  serialized: boolean;
}

export type CompressionWorkerResponse = {
  name: string;
  revision: number;
  compressed?: string;
  error?: string;
  serializationMs?: number;
  compressionMs?: number;
};

const workerScope = self as unknown as {
  addEventListener: (
    type: 'message',
    listener: (event: MessageEvent<CompressionWorkerRequest>) => void,
  ) => void;
  postMessage: (response: CompressionWorkerResponse) => void;
};

workerScope.addEventListener('message', (event) => {
  const { name, revision, payload, serialized } = event.data;
  try {
    const serializationStart = performance.now();
    const text = serialized ? String(payload) : JSON.stringify(payload);
    const compressionStart = performance.now();
    const compressed = compressToUTF16(text);
    const response: CompressionWorkerResponse = {
      name,
      revision,
      compressed,
      serializationMs: compressionStart - serializationStart,
      compressionMs: performance.now() - compressionStart,
    };
    workerScope.postMessage(response);
  } catch (error) {
    const response: CompressionWorkerResponse = {
      name,
      revision,
      error: error instanceof Error ? error.message : 'compression failed',
    };
    workerScope.postMessage(response);
  }
});
