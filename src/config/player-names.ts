/**
 * Player name pools by region.
 * Each region has surnames + given names; combined randomly when generating squads.
 *
 * Regions match TeamBase.region prefix ("大陆+xxx", "南洲+xxx", "东洲+xxx").
 * Special handling for 大陆+南朝鲜 / 大陆+北朝鲜 (Korean), 南洲+台湾 (Taiwan).
 */

// ── Mainland Chinese (大陆) ────────────────────────────────────
const MAINLAND_SURNAMES = [
  '王', '李', '张', '刘', '陈', '杨', '黄', '赵', '吴', '周',
  '徐', '孙', '马', '朱', '胡', '郭', '何', '高', '林', '罗',
  '郑', '梁', '谢', '宋', '唐', '许', '韩', '冯', '邓', '曹',
  '彭', '曾', '萧', '田', '董', '袁', '潘', '于', '蒋', '蔡',
  '余', '杜', '叶', '程', '苏', '魏', '吕', '丁', '任', '沈',
];
const MAINLAND_GIVEN = [
  '伟', '强', '磊', '军', '杰', '勇', '涛', '超', '明', '亮',
  '辉', '建国', '建军', '志强', '志伟', '志远', '宇航', '俊杰',
  '浩然', '子轩', '文博', '思源', '俊豪', '梓豪', '晓东', '海涛',
  '俊毅', '宇豪', '凯', '昊', '阳', '皓宇', '一鸣', '梓杰',
  '博文', '永康', '健', '剑', '彬', '飞', '磊鑫', '锋', '毅',
];

// ── Northeast / Northern China (东北、华北 — slight variation) ────
const NORTH_GIVEN = [
  '大壮', '宝山', '建华', '国栋', '满仓', '振宇', '振华', '振国',
  '玉龙', '玉成', '玉田', '小军', '志国', '永和', '永福',
];

// ── Southern Chinese / Cantonese (南洲) ──────────────────────────
const SOUTH_SURNAMES = [
  '陈', '梁', '黄', '何', '周', '吴', '邓', '林', '余', '罗',
  '麦', '关', '司徒', '欧阳', '邝', '冼', '简', '严', '尹', '骆',
  '甘', '谭', '岑', '汤', '翁', '伍', '钟', '柯', '蓝',
];
const SOUTH_GIVEN = [
  '家豪', '俊熙', '伟豪', '志聪', '俊彦', '建邦', '展鹏', '德华',
  '永成', '俊宝', '炳南', '伟权', '汉文', '伟康', '宏强', '永泰',
  '荣发', '锦荣', '景行', '可风', '俊辉', '永桦', '兆基', '梓谦',
];

// ── Taiwan (南洲+台湾) ───────────────────────────────────────────
const TAIWAN_SURNAMES = [
  '陈', '林', '黄', '张', '李', '王', '吴', '蔡', '刘', '杨',
  '许', '郑', '谢', '洪', '赖', '周', '叶', '苏', '简', '范',
];
const TAIWAN_GIVEN = [
  '志明', '俊宏', '冠廷', '建宏', '宇翔', '承翰', '柏翰', '彦廷',
  '宥廷', '咏胜', '宇豪', '彦伯', '思齐', '伟成', '柏宏', '柏豪',
  '泰宇', '建勋', '俊毅', '柏融', '彦霖', '怡君',
];

// ── Korean (南朝鲜 / 北朝鲜) ──────────────────────────────────────
const KOREAN_SURNAMES = [
  '金', '李', '朴', '崔', '郑', '姜', '赵', '尹', '张', '林',
  '韩', '吴', '申', '徐', '权', '黄', '安', '宋', '柳', '洪',
];
const KOREAN_GIVEN = [
  '志洙', '东国', '英杓', '兴民', '昌镐', '相浩', '镇洙', '泰熙',
  '光石', '正韩', '炳熙', '永权', '在范', '志诚', '景元', '武烈',
  '镇宇', '太焕', '承佑', '玹宇', '俊昊',
];

// ── Japanese (东洲) ─────────────────────────────────────────────
const JAPANESE_SURNAMES = [
  '佐藤', '铃木', '高桥', '田中', '渡边', '伊藤', '山本', '中村',
  '小林', '加藤', '吉田', '山田', '佐佐木', '山口', '松本', '井上',
  '木村', '林', '清水', '山崎', '森', '池田', '桥本', '阿部',
  '石川', '前田', '藤田', '后藤', '冈田', '长谷川',
];
const JAPANESE_GIVEN = [
  '健太', '翔太', '大辅', '隆太', '直树', '雅人', '健一', '修司',
  '勇气', '阳介', '太郎', '一郎', '次郎', '航平', '翔', '大地',
  '诚', '亮', '光辉', '裕也', '俊介', '智也', '隆志', '光太郎',
  '响', '蓝斗', '海斗', '凉太', '悠斗', '凛太朗',
];

// ── Region detection helpers ──────────────────────────────────────

function getRegionPool(region: string): { surnames: string[]; given: string[] } {
  // Korean
  if (region.includes('南朝鲜') || region.includes('北朝鲜')) {
    return { surnames: KOREAN_SURNAMES, given: KOREAN_GIVEN };
  }
  // Taiwan
  if (region.includes('台湾')) {
    return { surnames: TAIWAN_SURNAMES, given: TAIWAN_GIVEN };
  }
  // Eastern continent → Japanese
  if (region.startsWith('东洲')) {
    return { surnames: JAPANESE_SURNAMES, given: JAPANESE_GIVEN };
  }
  // Southern continent → Cantonese / Southern Chinese
  if (region.startsWith('南洲')) {
    return { surnames: SOUTH_SURNAMES, given: SOUTH_GIVEN };
  }
  // Northeast (吉林) and northern variants → some northern flavor
  if (region.includes('吉林') || region.includes('辽宁') || region.includes('黑龙江')) {
    return { surnames: MAINLAND_SURNAMES, given: [...MAINLAND_GIVEN, ...NORTH_GIVEN] };
  }
  // Mainland default
  return { surnames: MAINLAND_SURNAMES, given: MAINLAND_GIVEN };
}

/**
 * Generate a unique-within-team player name based on the team's region.
 * Caller passes a Set of already-used names to ensure uniqueness within the squad.
 */
export function pickPlayerName(
  region: string,
  used: Set<string>,
  rngPick: <T>(arr: T[]) => T,
): string {
  const pool = getRegionPool(region);
  // Try up to 30 attempts to get a unique name
  for (let i = 0; i < 30; i++) {
    const surname = rngPick(pool.surnames);
    const given = rngPick(pool.given);
    const name = `${surname}${given}`;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  // Fallback: append a digit suffix
  const surname = rngPick(pool.surnames);
  const given = rngPick(pool.given);
  return `${surname}${given}${used.size}`;
}
