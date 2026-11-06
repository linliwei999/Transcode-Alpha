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

/**
 * VP9 Alpha 的透明通道在独立码流里；默认解码器只出 yuv420p，
 * alphaextract 会失败并写出空文件。WebM 必须走 libvpx-vp9。
 */
function inputArgs(inName: string): string[] {
  return extOf(inName) === 'webm' ? ['-c:v', 'libvpx-vp9', '-i', inName] : ['-i', inName]
}

/**
 * 先升到 yuva444p16le 再处理：ProRes / 部分 Alpha 母带若直接
 * format=yuva420p 再 alphaextract，会抽成空边或近空片（体积异常小）。
 */
/** 彩色片：透明区域压成黑，避免 mask 差一点时闪出底色 */
const VF_COLOR = 'format=yuva444p16le,premultiply=inplace=1,format=yuv420p'
/** 遮罩片：抽出灰度 alpha */
const VF_MASK = 'format=yuva444p16le,alphaextract,format=yuv420p'

const X264_COLOR = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-preset', 'veryfast', '-bf', '0'] as const
const X264_MASK = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'veryfast', '-bf', '0'] as const

async function execOrThrow(ffmpeg: FFmpeg, args: string[]): Promise<void> {
  const code = await ffmpeg.exec(args)
  if (code !== 0) {
    throw new Error(`ffmpeg 失败（退出码 ${code}）`)
  }
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
  // 新一次转码才清上次残留；本轮结束后故意保留源片
  for (const stale of ['input.mp4', 'input.mov', 'input.webm', 'input.mkv', 'keyed-mid.webm']) {
    if (stale !== inName) await ffmpeg.deleteFile(stale).catch(() => undefined)
  }
  await ffmpeg.writeFile(inName, await fetchFile(file))

  const sim = options.similarity ?? 0.12
  const blend = options.blend ?? 0.08
  const keyColor = options.keyColor || '#8a8a8a'
  const vfKey = options.keyBackground ? keyFilter(keyColor, sim, blend) : null

  const files: ConvertResult['files'] = []

  if (plan.kind === 'webm-alpha') {
    const out = `${stem}-${options.platform}-alpha.webm`
    const vf = vfKey ?? 'format=yuva420p'
    await execOrThrow(ffmpeg, [
      ...inputArgs(inName),
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
      await execOrThrow(ffmpeg, [
        ...inputArgs(inName),
        '-an',
        '-vf', vfKey,
        '-c:v', 'libvpx-vp9',
        '-pix_fmt', 'yuva420p',
        '-auto-alt-ref', '0',
        '-b:v', '0',
        '-crf', '34',
        mid,
      ])
      await execOrThrow(ffmpeg, [
        ...inputArgs(mid),
        '-an',
        '-vf', VF_COLOR,
        ...X264_COLOR,
        colorOut,
      ])
      await execOrThrow(ffmpeg, [
        ...inputArgs(mid),
        '-an',
        '-vf', VF_MASK,
        ...X264_MASK,
        maskOut,
      ])
      // 中间片可清；源片保留，方便改参重转 / 对照遮罩
      await ffmpeg.deleteFile(mid).catch(() => undefined)
    } else {
      await execOrThrow(ffmpeg, [
        ...inputArgs(inName),
        '-an',
        '-vf', VF_COLOR,
        ...X264_COLOR,
        colorOut,
      ])
      await execOrThrow(ffmpeg, [
        ...inputArgs(inName),
        '-an',
        '-vf', VF_MASK,
        ...X264_MASK,
        maskOut,
      ])
    }

    const colorBlob = await readBlob(ffmpeg, colorOut, 'video/mp4')
    const maskBlob = await readBlob(ffmpeg, maskOut, 'video/mp4')
    if (maskBlob.size < 64) {
      throw new Error(
        '遮罩片导出失败（文件为空）。若母带是 VP9 Alpha WebM，请重试；仍失败则换 ProRes 4444 / 双片交付。',
      )
    }
    files.push(
      { name: colorOut, blob: colorBlob, mime: 'video/mp4' },
      { name: maskOut, blob: maskBlob, mime: 'video/mp4' },
    )
    if (isMaskSuspiciouslySmall(colorBlob.size, maskBlob.size)) {
      options.onLog?.(
        '警告：遮罩片异常偏小。请确认母带带 Alpha；灰底预览片请勾选「灰底 / 绿幕需先抠色」。',
      )
    }
  }

  // 故意不删 MEMFS 里的源片，便于连续重转与对照
  return { files, plan }
}

/** 正常双片里 mask 通常与 color 同量级；过小多半是 alpha 没抽出来 */
function isMaskSuspiciouslySmall(colorBytes: number, maskBytes: number): boolean {
  if (colorBytes < 50_000) return false
  return maskBytes < Math.max(32_768, colorBytes * 0.02)
}

async function readBlob(ffmpeg: FFmpeg, name: string, mime: string): Promise<Blob> {
  const data = await ffmpeg.readFile(name)
  const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data))
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  await ffmpeg.deleteFile(name).catch(() => undefined)
  return new Blob([copy.buffer], { type: mime })
}
