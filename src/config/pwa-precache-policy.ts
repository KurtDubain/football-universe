// URL matching must remain case-sensitive on every build host.
const deferredPageChunk = /^assets\/(?:AdvancedSearch|Calendar|Chronicle|CoachDetail|Coaches|Compare|Cup|History|League|Legends|Market|MemorableMatches|PlayerDetail|Players|Settings|TeamDetail|TeamEditor|Teams|Transfers)-[^/]+\.js$/;

// The ceremony overlay is a React.lazy chunk that most sessions never load, and
// its stylesheet rides with it. Precaching both would spend two of the 89 entries
// on a page that only turns at a season boundary or a cup final.
const deferredCeremonyChunk = /^assets\/Ceremony[A-Za-z]*-[^/]+\.(?:js|css)$/;

export function shouldPrecacheUrl(url: string): boolean {
  return !deferredPageChunk.test(url) && !deferredCeremonyChunk.test(url);
}

export function missingInitialPrecacheFiles(initialFiles: readonly string[], precacheUrls: readonly string[]): string[] {
  const cached = new Set(precacheUrls.map(url => url.replace(/^\/+/, '').split('?')[0]));
  return initialFiles.filter(file => file.endsWith('.js') && !cached.has(file));
}
