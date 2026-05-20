/**
 * Player name pools by region.
 *
 * Display rule (user-facing): all names rendered as Chinese characters, but
 * the *style* differs by continent to give each region a distinct flavor:
 *   - 大陆 → traditional Chinese names (王伟 / 陈香)
 *   - 大陆+南朝鲜 / 大陆+北朝鲜 → Korean (Chinese transliteration)
 *   - 东洲 → Japanese (Chinese transliteration: 田中健太 / 大谷一浪)
 *   - 南洲 → Western names transliterated to Chinese (史密斯·本杰明 / 约翰逊·大卫)
 *     all sub-regions of 南洲 (福建 / 广东 / 海南 / 台湾) share this pool —
 *     the 南洲 universe reads as a foreign / Latinate community to contrast
 *     with the 大陆 and 东洲 cultural flavors.
 *
 * Regions match TeamBase.region prefix ("大陆+xxx", "南洲+xxx", "东洲+xxx").
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
  '香', '宁', '岩', '冰', '哲', '风', '雷', '川',
];

// ── Northeast / Northern China (东北、华北 — slight variation) ────
const NORTH_GIVEN = [
  '大壮', '宝山', '建华', '国栋', '满仓', '振宇', '振华', '振国',
  '玉龙', '玉成', '玉田', '小军', '志国', '永和', '永福',
];

// ── Western / Latinate names transliterated to Chinese (南洲) ──────
// All 南洲 teams (福建 / 广东 / 海南 / 台湾) share this pool. Surname and
// given name are joined with a middle dot to read as a Western name in
// Chinese (史密斯·本杰明), distinct from the no-separator native names.
const WESTERN_SURNAMES = [
  '史密斯', '约翰逊', '威廉姆斯', '布朗', '琼斯', '米勒', '戴维斯',
  '加西亚', '罗德里格斯', '威尔逊', '马丁内斯', '安德森', '泰勒',
  '托马斯', '摩尔', '杰克逊', '马丁', '哈里斯', '克拉克', '刘易斯',
  '沃克', '罗宾逊', '怀特', '柯林斯', '霍尔', '汤普森', '亚当斯',
  '贝克', '尼尔森', '希尔', '坎贝尔', '米切尔', '罗伯茨', '菲利普斯',
  '埃文斯', '特纳', '帕克', '爱德华兹', '斯图尔特', '弗洛雷斯',
  '莫拉莱斯', '默里', '佩雷斯', '科尔', '霍华德', '沃德', '理查兹',
  '伯格', '舒尔茨', '范戴克',
];
const WESTERN_GIVEN = [
  '詹姆斯', '约翰', '罗伯特', '迈克尔', '威廉', '大卫', '理查德',
  '约瑟夫', '托马斯', '查尔斯', '克里斯托弗', '丹尼尔', '马修',
  '安东尼', '唐纳德', '史蒂文', '保罗', '安德鲁', '乔治', '凯文',
  '布赖恩', '本杰明', '杰森', '瑞恩', '卡尔', '杰里米', '加里',
  '雅各布', '内森', '卢卡斯', '伊森', '利亚姆', '诺亚', '梅森',
  '杰克', '卢克', '奥利弗', '哈里', '亨利', '阿瑟', '西奥', '莱昂',
  '乔丹', '迪伦', '加布里埃尔', '奥斯卡', '马尔科', '塞巴斯蒂安',
  '阿德里安', '尼古拉斯', '亚历山大', '马克西米利安', '费利克斯',
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
  '石川', '前田', '藤田', '后藤', '冈田', '长谷川', '大谷', '本田',
  '稻田', '中田', '远藤', '镰田', '冨安', '南野', '三笘', '富安',
];
const JAPANESE_GIVEN = [
  '健太', '翔太', '大辅', '隆太', '直树', '雅人', '健一', '修司',
  '勇气', '阳介', '太郎', '一郎', '次郎', '航平', '翔', '大地',
  '诚', '亮', '光辉', '裕也', '俊介', '智也', '隆志', '光太郎',
  '响', '蓝斗', '海斗', '凉太', '悠斗', '凛太朗', '一浪', '翔平',
  '健斗', '宗佑', '雄太', '隼人', '颯太', '凉介',
];

// ── Region detection helpers ──────────────────────────────────────

interface NamePool {
  surnames: string[];
  given: string[];
  /** Separator between surname and given. Western names use '·' so they read
   *  like "史密斯·本杰明"; Asian conventions concatenate with no separator. */
  separator: string;
}

function getRegionPool(region: string): NamePool {
  // Korean — Asian, no separator
  if (region.includes('南朝鲜') || region.includes('北朝鲜')) {
    return { surnames: KOREAN_SURNAMES, given: KOREAN_GIVEN, separator: '' };
  }
  // Eastern continent → Japanese (no separator)
  if (region.startsWith('东洲')) {
    return { surnames: JAPANESE_SURNAMES, given: JAPANESE_GIVEN, separator: '' };
  }
  // Southern continent → Western transliterated. All sub-regions of 南洲
  // (福建 / 广东 / 海南 / 台湾) share one pool. Middle dot separator.
  if (region.startsWith('南洲')) {
    return { surnames: WESTERN_SURNAMES, given: WESTERN_GIVEN, separator: '·' };
  }
  // Northeast (吉林) and northern variants → some northern flavor
  if (region.includes('吉林') || region.includes('辽宁') || region.includes('黑龙江')) {
    return { surnames: MAINLAND_SURNAMES, given: [...MAINLAND_GIVEN, ...NORTH_GIVEN], separator: '' };
  }
  // Mainland default
  return { surnames: MAINLAND_SURNAMES, given: MAINLAND_GIVEN, separator: '' };
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
    const name = `${surname}${pool.separator}${given}`;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  // Fallback: append a digit suffix
  const surname = rngPick(pool.surnames);
  const given = rngPick(pool.given);
  return `${surname}${pool.separator}${given}${used.size}`;
}
