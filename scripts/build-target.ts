export type BuildTarget = 'personal' | 'contest' | 'audit';
export function resolveBuildTarget(mode: string, env: Record<string, string | undefined>) {
  const target = mode === 'development' || mode === 'production' || mode === 'test' ? 'personal' : mode;
  if (!['personal', 'contest', 'audit'].includes(target)) throw new Error('Unknown build target: ' + mode);
  const edition = target === 'contest' ? 'contest' : 'personal';
  const presetId = edition === 'contest' ? 'three-shores-v1' : 'personal-v1';
  const audit = target === 'audit';
  if (env.APP_EDITION && env.APP_EDITION !== edition) throw new Error('APP_EDITION conflicts with build command');
  if (env.APP_PRESET_ID && env.APP_PRESET_ID !== presetId) throw new Error('APP_PRESET_ID conflicts with build command');
  if (env.VITE_ENABLE_AUDIT !== undefined && env.VITE_ENABLE_AUDIT !== String(audit)) throw new Error('VITE_ENABLE_AUDIT conflicts with build command');
  let siteUrl = 'https://football-universe-ebon.vercel.app';
  if (edition === 'contest') {
    if (!env.CONTEST_SITE_URL) throw new Error('CONTEST_SITE_URL is required');
    const url = new URL(env.CONTEST_SITE_URL);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash
      || url.hostname === 'football-universe-ebon.vercel.app') throw new Error('CONTEST_SITE_URL must be an independent HTTPS origin');
    siteUrl = url.origin;
  }
  return { target: target as BuildTarget, edition, presetId, audit, siteUrl, outDir: 'dist/' + target };
}
