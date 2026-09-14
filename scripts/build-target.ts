export type BuildTarget = 'personal' | 'contest' | 'audit';
export const DEFAULT_PERSONAL_SITE_URL = 'https://football-universe-ebon.vercel.app';

function httpsOrigin(name: string, value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(name + ' must be an HTTPS origin without a path, credentials, query or fragment');
  }
  return url.origin;
}

export function resolveBuildTarget(mode: string, env: Record<string, string | undefined>) {
  const target = mode === 'development' || mode === 'production' || mode === 'test' ? 'personal' : mode;
  if (!['personal', 'contest', 'audit'].includes(target)) throw new Error('Unknown build target: ' + mode);
  const edition = target === 'contest' ? 'contest' : 'personal';
  const presetId = edition === 'contest' ? 'three-shores-v1' : 'personal-v1';
  const audit = target === 'audit';
  if (env.APP_EDITION && env.APP_EDITION !== edition) throw new Error('APP_EDITION conflicts with build command');
  if (env.APP_PRESET_ID && env.APP_PRESET_ID !== presetId) throw new Error('APP_PRESET_ID conflicts with build command');
  if (env.VITE_ENABLE_AUDIT !== undefined && env.VITE_ENABLE_AUDIT !== String(audit)) throw new Error('VITE_ENABLE_AUDIT conflicts with build command');
  const personalSiteUrl = httpsOrigin('PERSONAL_SITE_URL', env.PERSONAL_SITE_URL ?? DEFAULT_PERSONAL_SITE_URL);
  const contestSiteUrl = env.CONTEST_SITE_URL === undefined ? undefined : httpsOrigin('CONTEST_SITE_URL', env.CONTEST_SITE_URL);
  if (contestSiteUrl === personalSiteUrl || (contestSiteUrl && new URL(contestSiteUrl).hostname === new URL(DEFAULT_PERSONAL_SITE_URL).hostname)) {
    throw new Error('CONTEST_SITE_URL must be an independent HTTPS origin');
  }
  let siteUrl = personalSiteUrl;
  if (edition === 'contest') {
    if (!contestSiteUrl) throw new Error('CONTEST_SITE_URL is required');
    siteUrl = contestSiteUrl;
  }
  return { target: target as BuildTarget, edition, presetId, audit, siteUrl, outDir: 'dist/' + target };
}
