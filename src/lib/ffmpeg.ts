import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'

/** 用户选的目标平台（网页按此自动选格式） */
export type Platform = 'ios' | 'android' | 'harmony' | 'universal' | 'web'

export type PlatformPlan = {
  platform: Platform
  title: string
  /** 自动产出说明 */
  outputLabel: string
  desc: string
  kind: 'webm-alpha' | 'dual-mp4'
}

export const PLATFORMS: PlatformPlan[] = [
  {
    platform: 'ios',
    title: 'iOS',
    outputLabel: '双片 MP4（画面 + 遮罩）',
    desc: '网页编不了 HEVC+Alpha；双片 H.264 可直接进 App 合成透明。',
    kind: 'dual-mp4',
  },
  {
    platform: 'android',
    title: '安卓',
    outputLabel: 'VP9 Alpha · WebM',
    desc: '单文件带透明，多数安卓播放器 / ExoPlayer 可接。',
    kind: 'webm-alpha',
  },
  {
    platform: 'harmony',
    title: '鸿蒙',
    outputLabel: '双片 MP4（画面 + 遮罩）',
    desc: '兼容性优先：两路标准 MP4，端上合成透明最稳。',
    kind: 'dual-mp4',
  },
  {
    platform: 'universal',
    title: '三端通用',
    outputLabel: '双片 MP4（画面 + 遮罩）',
    desc: '一份素材打 iOS / 安卓 / 鸿蒙，体积略大但不用各转一版。',
    kind: 'dual-mp4',
  },
  {
    platform: 'web',
    title: '网页',
    outputLabel: 'VP9 Alpha · WebM',
    desc: 'Chrome / Firefox 等可直接播透明 WebM。',
    kind: 'webm-alpha',
  },
]

export function planFor(platform: Platform): PlatformPlan {
  return PLATFORMS.find((p) => p.platform === platform) ?? PLATFORMS[3]
}

export type ConvertOptions = {
  platform: Platform
  /** 源片是灰底/绿幕，需要先抠色再导出 */
  keyBackground: boolean
  keyColor?: string
  similarity?: number
  blend?: number
  onProgress?: (ratio: number) => void
  onLog?: (line: string) => void
}

export type ConvertResult = {
  files: { name: string; blob: Blob; mime: string }[]
  plan: PlatformPlan
}

let ffmpegSingleton: FFmpeg | null = null
let loadPromise: Promise<FFmpeg> | null = null

export async function getFFmpeg(onLog?: (line: string) => void): Promise<FFmpeg> {
  if (ffmpegSingleton?.loaded) return ffmpegSingleton
  if (loadPromise) return loadPromise

  loadPromise = (async () => {
    const ffmpeg = new FFmpeg()
    ffmpeg.on('log', ({ message }) => onLog?.(message))
    const base = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm'
    await ffmpeg.load({
      coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
    })
    ffmpegSingleton = ffmpeg
    return ffmpeg
  })()

  try {
    return await loadPromise
  } catch (e) {
    loadPromise = null
    throw e
  }
}

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toLowerCase() : 'mp4'
}

function stemOf(name: string): string {
  const base = name.split(/[/\\]/).pop() || 'input'
  const i = base.lastIndexOf('.')
  return i >= 0 ? base.slice(0, i) : base
}

function keyFilter(keyColor: string, similarity: number, blend: number): string {
  const color = keyColor.replace('#', '')
  return `colorkey=0x${color}:${similarity}:${blend},format=yuva420p`
}

/** 按目标平台自动选格式；可选先抠灰底/绿幕。 */
export async function convertVideo(
  file: File,
  options: ConvertOptions,
): Promise<ConvertResult> {
  const plan = planFor(options.platform)
  const ffmpeg = await getFFmpeg(options.onLog)
  ffmpeg.on('progress', ({ progress }) => {
    options.onProgress?.(Math.min(1, Math.max(0, progress)))
  })

  const inName = `input.${extOf(file.name)}`
  const stem = stemOf(file.name)
  await ffmpeg.writeFile(inName, await fetchFile(file))

  const sim = options.similarity ?? 0.12
  const blend = options.blend ?? 0.08
  const keyColor = options.keyColor || '#8a8a8a'
  const vfKey = options.keyBackground ? keyFilter(keyColor, sim, blend) : null

  const files: ConvertResult['files'] = []

  if (plan.kind === 'webm-alpha') {
    const out = `${stem}-${options.platform}-alpha.webm`
    const vf = vfKey ?? 'format=yuva420p'
    await ffmpeg.exec([
      '-i', inName,
      '-an',
      '-vf', vf,
      '-c:v', 'libvpx-vp9',
      '-pix_fmt', 'yuva420p',
      '-auto-alt-ref', '0',
      '-b:v', '0',
      '-crf', '32',
      out,
    ])
    files.push({
      name: out,
      blob: await readBlob(ffmpeg, out, 'video/webm'),
      mime: 'video/webm',
    })
  } else {
    const colorOut = `${stem}-${options.platform}-color.mp4`
    const maskOut = `${stem}-${options.platform}-mask.mp4`

    if (vfKey) {
      // 先落到带 alpha 的中间 WebM，再拆双片（wasm 里复杂 filtergraph 更稳）
      const mid = 'keyed-mid.webm'
      await ffmpeg.exec([
        '-i', inName,
        '-an',
        '-vf', vfKey,
        '-c:v', 'libvpx-vp9',
        '-pix_fmt', 'yuva420p',
        '-auto-alt-ref', '0',
        '-b:v', '0',
        '-crf', '34',
        mid,
      ])
      await ffmpeg.exec([
        '-i', mid,
        '-an',
        '-vf', 'format=yuv420p',
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-crf', '20',
        '-preset', 'veryfast',
        colorOut,
      ])
      await ffmpeg.exec([
        '-i', mid,
        '-an',
        '-vf', 'alphaextract,format=yuv420p',
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-crf', '18',
        '-preset', 'veryfast',
        maskOut,
      ])
      await ffmpeg.deleteFile(mid).catch(() => undefined)
    } else {
      await ffmpeg.exec([
        '-i', inName,
        '-an',
        '-vf', 'format=yuv420p',
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-crf', '20',
        '-preset', 'veryfast',
        colorOut,
      ])
      await ffmpeg.exec([
        '-i', inName,
        '-an',
        '-vf', 'alphaextract,format=yuv420p',
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-crf', '18',
        '-preset', 'veryfast',
        maskOut,
      ])
    }

    files.push(
      {
        name: colorOut,
        blob: await readBlob(ffmpeg, colorOut, 'video/mp4'),
        mime: 'video/mp4',
      },
      {
        name: maskOut,
        blob: await readBlob(ffmpeg, maskOut, 'video/mp4'),
        mime: 'video/mp4',
      },
    )
  }

  try {
    await ffmpeg.deleteFile(inName)
  } catch {
    /* ignore */
  }

  return { files, plan }
}

async function readBlob(ffmpeg: FFmpeg, name: string, mime: string): Promise<Blob> {
  const data = await ffmpeg.readFile(name)
  const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data))
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  await ffmpeg.deleteFile(name).catch(() => undefined)
  return new Blob([copy.buffer], { type: mime })
}
