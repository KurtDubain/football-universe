// URL matching must remain case-sensitive on every build host.
const deferredPageChunk = /^assets\/(?:AdvancedSearch|Calendar|Chronicle|CoachDetail|Coaches|Compare|Cup|History|League|Legends|Market|MemorableMatches|PlayerDetail|Players|Settings|TeamDetail|TeamEditor|Teams|Transfers)-[^/]+\.js$/;

export function shouldPrecacheUrl(url: string): boolean {
  return !deferredPageChunk.test(url);
}

export function missingInitialPrecacheFiles(initialFiles: readonly string[], precacheUrls: readonly string[]): string[] {
  const cached = new Set(precacheUrls.map(url => url.replace(/^\/+/, '').split('?')[0]));
  return initialFiles.filter(file => file.endsWith('.js') && !cached.has(file));
}
