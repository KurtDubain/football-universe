/**
 * Derby rivalries — classic matchups that get extra drama.
 * Each entry is a pair of team IDs.
 */
export const DERBIES: [string, string][] = [
  // 西班牙国家德比
  ['real_madrid', 'barcelona'],
  // 马德里德比
  ['real_madrid', 'atletico'],
  // 米兰德比
  ['inter', 'ac_milan'],
  // 英超双红会
  ['liverpool', 'man_city'],
  // 伦敦德比
  ['arsenal', 'chelsea'],
  ['arsenal', 'tottenham'],
  ['chelsea', 'tottenham'],
  // 德国国家德比
  ['bayern', 'dortmund'],
  // 法国经典
  ['psg', 'marseille'],
  // 中超经典
  ['shanghai_port', 'beijing_guoan'],
  ['shandong', 'beijing_guoan'],
];

export const DERBY_NAMES: Record<string, string> = {
  'real_madrid-barcelona': '西班牙国家德比',
  'barcelona-real_madrid': '西班牙国家德比',
  'real_madrid-atletico': '马德里德比',
  'atletico-real_madrid': '马德里德比',
  'inter-ac_milan': '米兰德比',
  'ac_milan-inter': '米兰德比',
  'liverpool-man_city': '英超巅峰对决',
  'man_city-liverpool': '英超巅峰对决',
  'arsenal-chelsea': '伦敦德比',
  'chelsea-arsenal': '伦敦德比',
  'arsenal-tottenham': '北伦敦德比',
  'tottenham-arsenal': '北伦敦德比',
  'chelsea-tottenham': '伦敦德比',
  'tottenham-chelsea': '伦敦德比',
  'bayern-dortmund': '德国国家德比',
  'dortmund-bayern': '德国国家德比',
  'psg-marseille': '法国经典德比',
  'marseille-psg': '法国经典德比',
  'shanghai_port-beijing_guoan': '京沪大战',
  'beijing_guoan-shanghai_port': '京沪大战',
  'shandong-beijing_guoan': '北方德比',
  'beijing_guoan-shandong': '北方德比',
};

export function isDerby(homeId: string, awayId: string): boolean {
  return DERBIES.some(([a, b]) => (a === homeId && b === awayId) || (b === homeId && a === awayId));
}

export function getDerbyName(homeId: string, awayId: string): string | null {
  return DERBY_NAMES[`${homeId}-${awayId}`] ?? DERBY_NAMES[`${awayId}-${homeId}`] ?? null;
}
