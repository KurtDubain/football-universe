export interface VisualAssetEnvironment {
  saveData?: boolean;
  hardwareConcurrency?: number;
  deviceMemory?: number;
}

export function shouldSuppressDecorativeArtwork(
  environment: VisualAssetEnvironment,
): boolean {
  if (environment.saveData) return true;
  if (
    environment.hardwareConcurrency !== undefined
    && environment.hardwareConcurrency <= 1
  ) return true;
  return environment.deviceMemory !== undefined && environment.deviceMemory <= 1;
}

export function readVisualAssetEnvironment(): VisualAssetEnvironment {
  const connection = (navigator as Navigator & {
    connection?: { saveData?: boolean };
  }).connection;
  const deviceMemory = (navigator as Navigator & {
    deviceMemory?: number;
  }).deviceMemory;
  return {
    saveData: connection?.saveData,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory,
  };
}
