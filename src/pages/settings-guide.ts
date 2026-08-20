import { BALANCE } from '../config/balance';
import type { IconName } from '../components/Icon';

export interface SettingsGuideItem {
  key: string;
  title: string;
  icon: IconName;
  content: string;
}

export const SETTINGS_GUIDE_ITEMS: readonly SettingsGuideItem[] = [
  {
    key: 'core', title: '核心玩法', icon: 'eye',
    content: '这是一个「观赛型」足球模拟器 — 你不操控比赛，而是观看整个足球宇宙自动演化。每次点击「推进」，日历向前一步：联赛轮次、杯赛回合、赛季结算依次发生。升降级、教练解雇、杯赛冷门、王朝崛起……一切自然涌现。你可以设定关注球队，追踪它的命运。',
  },
  {
    key: 'league', title: '联赛体系', icon: 'stadium',
    content: '三级联赛：顶级(16队)、甲级(8队)、乙级(8队)。顶级双循环30轮，甲乙双循环14轮。赛季末：顶级后2名直接降级，倒数第3与甲级第3进行中立场单回合附加赛；甲级与乙级之间采用相同规则。积分相同比净胜球，再同比进球数。',
  },
  {
    key: 'cups', title: '杯赛赛制', icon: 'trophy',
    content: '联赛杯：32队中立场单回合淘汰。超级杯：16队主客场小组赛后进入两回合淘汰赛，决赛为中立场单回合。洲际杯：S5起每6季举办一次，大陆全部16队、南洲和东洲各自全部8队参赛，近5季俱乐部积分只用于分档和同分排序；3轮中立场小组赛后进行单回合淘汰赛。环球冠军杯：每4季举办一次，32队进行3轮中立场小组赛及单回合淘汰赛。',
  },
  {
    key: 'match', title: '比赛模拟', icon: 'ball',
    content: `影响比赛结果的因素：球队OVR、实际首发、教练加成、自动阵型与策略、士气(${(BALANCE.MORALE_WEIGHT * 100).toFixed(0)}%)、体能(${(BALANCE.FATIGUE_WEIGHT * 100).toFixed(0)}%)和动量(${(BALANCE.MOMENTUM_WEIGHT * 100).toFixed(0)}%)。弱队不会获得隐藏固定补正；教练会结合实力差、体能和赛事阶段选择低位防守或快速反击，优势与代价同时进入比赛模型。真实主场比赛具有${(BALANCE.HOME_ADVANTAGE * 100).toFixed(0)}%主场优势；世界杯、洲际杯、联赛杯、单回合决赛和升降级附加赛均为中立场，不应用该加成。世界杯东道主仅在自己的比赛中获得独立的${(BALANCE.WORLD_CUP_HOST_ADVANTAGE * 100).toFixed(0)}%赛会氛围加成，不叠加普通主场优势。杯赛比联赛更不确定(波动${(BALANCE.CUP_RANDOMNESS * 100).toFixed(0)}% vs ${(BALANCE.LEAGUE_RANDOMNESS * 100).toFixed(0)}%)。进球数基于泊松分布采样。`,
  },
  {
    key: 'coach', title: '教练系统', icon: 'tie',
    content: `每位教练有评分、风格(进攻/防守/均衡/控球/反击)和6项加成。连续输球会累积压力，压力超过${BALANCE.FIRING_THRESHOLD}即被解雇。豪门压力增速×${BALANCE.ELITE_TEAM_PRESSURE_MULT}。被解雇的教练进入待业状态，等待下家。少数教练在巅峰时期会选择急流勇退。`,
  },
  {
    key: 'growth', title: '球队变化', icon: 'trend-up',
    content: '赛季结束时球队OVR会根据战绩变化：冠军和升级队伍成长，降级和垫底队伍下滑。长期来看豪门有底蕴优势，但弱队也能通过连续好成绩逐步崛起。世界杯冠军的所在联赛也会有微小加成。',
  },
  {
    key: 'state', title: '球队状态', icon: 'bolt',
    content: '士气(Morale)：胜利提升、失败下降，影响比赛发挥。体能(Fatigue)：每场比赛消耗体能，休息时恢复，密集赛程是隐形杀手。动量(Momentum)：连胜/连败会形成正/负动量惯性。阵容健康(SquadHealth)：伤病和红牌会削弱阵容厚度。',
  },
  {
    key: 'derby', title: '德比与成就', icon: 'fire',
    content: '游戏内设有11组经典德比(国家德比、同城德比等)，德比战双方都会获得额外战意加成。赛季中还会触发随机事件(伤病潮、妖星涌现、资金注入等)。达成特殊条件(不败赛季、百分赛季等)会解锁成就。',
  },
];
