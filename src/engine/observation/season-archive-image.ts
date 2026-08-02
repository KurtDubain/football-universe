import seasonArchiveFrameUrl from '../../assets/visual/season-archive-frame-v1.webp';

export interface SeasonArchiveImageInput {
  seasonNumber: number;
  teamName: string;
  teamColor: string;
  fateLabel: string;
  fateDetail: string;
  impressionLabel: string;
  impressionDetail: string;
  judgmentLine: string;
  themeLine?: string;
  representativeLine?: string;
  deviationLine?: string;
  cupLine: string;
  nextWatch: string;
}

const WIDTH = 1200;
const HEIGHT = 1500;
const PADDING = 120;
const FONT = '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
let archiveFramePromise: Promise<HTMLImageElement | null> | null = null;

async function loadArchiveFrame(): Promise<HTMLImageElement | null> {
  if (archiveFramePromise) return archiveFramePromise;
  archiveFramePromise = (async () => {
    if (typeof Image === 'undefined') return null;
    const image = new Image();
    image.decoding = 'async';
    image.src = seasonArchiveFrameUrl;
    if (typeof image.decode === 'function') {
      try {
        await image.decode();
        return image;
      } catch {
        return null;
      }
    }
    return new Promise<HTMLImageElement | null>(resolve => {
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
    });
  })();
  return archiveFramePromise;
}

function splitText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  let line = '';
  for (const character of text) {
    const next = line + character;
    if (line && context.measureText(next).width > maxWidth) {
      lines.push(line);
      line = character;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawWrappedText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines = 3,
): number {
  const lines = splitText(context, text, maxWidth).slice(0, maxLines);
  lines.forEach((line, index) => context.fillText(line, x, y + index * lineHeight));
  return y + lines.length * lineHeight;
}

function drawRule(context: CanvasRenderingContext2D, y: number): void {
  context.strokeStyle = '#334155';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(PADDING, y);
  context.lineTo(WIDTH - PADDING, y);
  context.stroke();
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('浏览器未能生成档案图片'));
    }, 'image/png');
  });
}

export function seasonArchiveFilename(seasonNumber: number): string {
  return `football-universe-S${seasonNumber}-observer-archive.png`;
}

export async function downloadSeasonArchiveImage(
  input: SeasonArchiveImageInput,
): Promise<void> {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器不支持图片导出');

  context.fillStyle = '#0f172a';
  context.fillRect(0, 0, WIDTH, HEIGHT);
  const archiveFrame = await loadArchiveFrame();
  if (archiveFrame) context.drawImage(archiveFrame, 0, 0, WIDTH, HEIGHT);
  context.fillStyle = input.teamColor;
  context.fillRect(74, 76, 10, HEIGHT - 152);

  context.fillStyle = '#34d399';
  context.font = `600 28px ${FONT}`;
  context.fillText(`FOOTBALL UNIVERSE · S${input.seasonNumber}`, PADDING, 144);
  context.fillStyle = '#f8fafc';
  context.font = `800 64px ${FONT}`;
  let y = drawWrappedText(context, input.teamName, PADDING, 238, WIDTH - PADDING * 2, 78, 2);
  y += 42;

  context.fillStyle = '#94a3b8';
  context.font = `500 26px ${FONT}`;
  context.fillText('最终命运', PADDING, y);
  context.fillStyle = '#f8fafc';
  context.font = `800 50px ${FONT}`;
  context.fillText(input.fateLabel, PADDING, y + 66);
  context.fillStyle = '#cbd5e1';
  context.font = `400 28px ${FONT}`;
  y = drawWrappedText(context, input.fateDetail, PADDING, y + 116, WIDTH - PADDING * 2, 42, 3) + 36;

  drawRule(context, y);
  y += 58;
  context.fillStyle = '#94a3b8';
  context.font = `500 26px ${FONT}`;
  context.fillText('观察印象', PADDING, y);
  context.fillStyle = '#34d399';
  context.font = `800 44px ${FONT}`;
  context.fillText(input.impressionLabel, PADDING, y + 60);
  context.fillStyle = '#cbd5e1';
  context.font = `400 27px ${FONT}`;
  y = drawWrappedText(context, input.impressionDetail, PADDING, y + 108, WIDTH - PADDING * 2, 41, 3) + 22;
  context.fillStyle = '#94a3b8';
  context.font = `500 25px ${FONT}`;
  context.fillText(input.judgmentLine, PADDING, y);
  y += 54;

  const evidence = [
    input.themeLine,
    input.representativeLine,
    input.deviationLine,
    input.cupLine,
  ].filter((line): line is string => Boolean(line));
  drawRule(context, y);
  y += 52;
  context.fillStyle = '#94a3b8';
  context.font = `600 25px ${FONT}`;
  context.fillText('本季证据', PADDING, y);
  y += 50;
  context.font = `400 26px ${FONT}`;
  for (const line of evidence) {
    context.fillStyle = '#34d399';
    context.fillRect(PADDING, y - 18, 8, 8);
    context.fillStyle = '#e2e8f0';
    y = drawWrappedText(context, line, PADDING + 28, y, WIDTH - PADDING * 2 - 28, 40, 2) + 24;
  }

  drawRule(context, y);
  y += 56;
  context.fillStyle = '#94a3b8';
  context.font = `600 25px ${FONT}`;
  context.fillText('下一季悬念', PADDING, y);
  context.fillStyle = '#f8fafc';
  context.font = `600 32px ${FONT}`;
  drawWrappedText(context, input.nextWatch, PADDING, y + 58, WIDTH - PADDING * 2, 48, 3);

  context.fillStyle = '#64748b';
  context.font = `400 22px ${FONT}`;
  context.fillText('一段历史，不是一项任务。', PADDING, HEIGHT - 76);

  const blob = await canvasToBlob(canvas);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = seasonArchiveFilename(input.seasonNumber);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
