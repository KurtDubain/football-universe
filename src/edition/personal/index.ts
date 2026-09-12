import identities from './identities.json';
import * as namePools from './name-pools';
export { namePools };
export const preset = {
  ...identities,
  repositoryUrl: 'https://github.com/KurtDubain/football-universe' as string | null,
  teams: identities.teams as Record<string, { name: string; shortName: string; region: string }>,
  edition: 'personal',
  presetId: 'personal-v1',
  label: '个人版',
  allowCustomContent: true,
  peninsulaRegions: ['南朝鲜', '北朝鲜'],
  northernRegions: ['吉林', '辽宁', '黑龙江'],
  legacyShortNames: [{ teamId: 'tsmc_fc', from: 'Env', to: '台积' }],
};
