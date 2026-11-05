import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'

export type OutputMode = 'webm-alpha' | 'dual-mp4' | 'keyed-webm'

export type ConvertOptions = {
  mode: OutputMode
  /** 抠色：#RRGGBB，仅 keyed-webm 使用 */
  keyColor?: string
  similarity?: number
  blend?: number
  onProgress?: (ratio: number) => void
  onLog?: (line: string) => void
}

export type ConvertResult = {
  files: { name: string; blob: Blob; mime: string }[]
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

/** 浏览器内转码。HEVC+Alpha 需 Apple 硬件，网页做不了——这里产出 VP9 Alpha 与双片 MP4。 */
export async function convertVideo(
  file: File,
  options: ConvertOptions,
): Promise<ConvertResult> {
  const ffmpeg = await getFFmpeg(options.onLog)
  ffmpeg.on('progress', ({ progress }) => {
    options.onProgress?.(Math.min(1, Math.max(0, progress)))
  })

  const inName = `input.${extOf(file.name)}`
  const stem = stemOf(file.name)
  await ffmpeg.writeFile(inName, await fetchFile(file))

  const files: ConvertResult['files'] = []

  if (options.mode === 'webm-alpha') {
    const out = `${stem}-alpha.webm`
    await ffmpeg.exec([
      '-i', inName,
      '-an',
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
  } else if (options.mode === 'keyed-webm') {
    const color = (options.keyColor || '#8a8a8a').replace('#', '')
    const sim = String(options.similarity ?? 0.12)
    const blend = String(options.blend ?? 0.08)
    const out = `${stem}-keyed-alpha.webm`
    // colorkey 后强制带 alpha 的 VP9
    await ffmpeg.exec([
      '-i', inName,
      '-an',
      '-vf', `colorkey=0x${color}:${sim}:${blend},format=yuva420p`,
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
    // 双片：彩色画面 + 黑白遮罩，三端都能用 H.264 MP4
    const colorOut = `${stem}-color.mp4`
    const maskOut = `${stem}-mask.mp4`
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

  return { files }
}

async function readBlob(ffmpeg: FFmpeg, name: string, mime: string): Promise<Blob> {
  const data = await ffmpeg.readFile(name)
  const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data))
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  await ffmpeg.deleteFile(name).catch(() => undefined)
  return new Blob([copy.buffer], { type: mime })
}
