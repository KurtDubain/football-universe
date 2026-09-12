import identities from './identities.json';
import * as namePools from './name-pools';
export { namePools };
export const preset = {
  ...identities,
  repositoryUrl: null as string | null,
  teams: identities.teams as Record<string, { name: string; shortName: string; region: string }>,
  edition: 'contest',
  presetId: 'three-shores-v1',
  label: '参赛版 · 三岸纪',
  allowCustomContent: false,
  sandboxDescription: '使用内置参赛球队，不提供球队编辑或导入',
  peninsulaRegions: ['晴川', '暮川'],
  northernRegions: ['霜河'],
  legacyShortNames: [] as { teamId: string; from: string; to: string }[],
};
