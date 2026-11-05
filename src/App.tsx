import { useCallback, useMemo, useState } from 'react'
import { convertVideo, type OutputMode } from './lib/ffmpeg'

type BgMode = 'checker' | '#5b4a8a' | '#0d0d0f' | '#e8e4dc'

type OutFile = { name: string; blob: Blob; mime: string; url: string }

const MODES: { id: OutputMode; title: string; desc: string }[] = [
  {
    id: 'webm-alpha',
    title: 'VP9 Alpha · WebM',
    desc: '保留透明通道。适合安卓 / 网页；也可再转到 iOS HEVC+Alpha。',
  },
  {
    id: 'dual-mp4',
    title: '双片 MP4（画面 + 遮罩）',
    desc: '两路标准 H.264，iOS / 安卓 / 鸿蒙都能播，App 里自己合成透明。',
  },
  {
    id: 'keyed-webm',
    title: '抠色 → VP9 Alpha',
    desc: '灰底 / 绿幕预览片抠成透明 WebM（外包常交灰底 H.264 时用）。',
  },
]

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

export default function App() {
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [mode, setMode] = useState<OutputMode>('keyed-webm')
  const [keyColor, setKeyColor] = useState('#8a8a8a')
  const [similarity, setSimilarity] = useState(0.12)
  const [blend, setBlend] = useState(0.08)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [outputs, setOutputs] = useState<OutFile[]>([])
  const [bg, setBg] = useState<BgMode>('checker')
  const [drag, setDrag] = useState(false)

  const modeMeta = useMemo(() => MODES.find((m) => m.id === mode)!, [mode])

  const revokeOutputs = useCallback((list: OutFile[]) => {
    list.forEach((f) => URL.revokeObjectURL(f.url))
  }, [])

  const pickFile = useCallback(
    (next: File | null) => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      revokeOutputs(outputs)
      setOutputs([])
      setError('')
      setStatus('')
      setProgress(0)
      setFile(next)
      setPreviewUrl(next ? URL.createObjectURL(next) : null)
    },
    [outputs, previewUrl, revokeOutputs],
  )

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDrag(false)
    const f = e.dataTransfer.files?.[0]
    if (f) pickFile(f)
  }

  const run = async () => {
    if (!file || busy) return
    setBusy(true)
    setError('')
    setStatus('正在加载 ffmpeg（首次约几十秒）…')
    setProgress(0)
    revokeOutputs(outputs)
    setOutputs([])

    try {
      const result = await convertVideo(file, {
        mode,
        keyColor,
        similarity,
        blend,
        onProgress: (r) => {
          setProgress(r)
          setStatus(`转码中… ${Math.round(r * 100)}%`)
        },
      })
      const next = result.files.map((f) => ({
        ...f,
        url: URL.createObjectURL(f.blob),
      }))
      setOutputs(next)
      setProgress(1)
      setStatus(`完成 · ${next.map((f) => formatBytes(f.blob.size)).join(' / ')}`)
      if (next[0]) {
        if (previewUrl) URL.revokeObjectURL(previewUrl)
        setPreviewUrl(next[0].url)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      setStatus('')
    } finally {
      setBusy(false)
    }
  }

  const shellStyle =
    bg === 'checker'
      ? undefined
      : ({ backgroundColor: bg, backgroundImage: 'none' } as React.CSSProperties)

  return (
    <div className="app">
      <header className="hero">
        <h1 className="brand">
          Transcode <span>Alpha</span>
        </h1>
        <p className="tagline">
          把带透明通道的动作视频，转成各端能用的格式。全部在浏览器本地完成，文件不上传。
        </p>
        <div className="badge-row">
          <span className="badge">本地 ffmpeg.wasm</span>
          <span className="badge">VP9 Alpha</span>
          <span className="badge">双片 MP4</span>
          <span className="badge">灰底抠色</span>
        </div>
      </header>

      <div className="layout">
        <section className="panel">
          <h2>输入与导出</h2>

          <div
            className={`drop${drag ? ' drag' : ''}`}
            onDragOver={(e) => {
              e.preventDefault()
              setDrag(true)
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={onDrop}
            onClick={() => document.getElementById('file-input')?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                document.getElementById('file-input')?.click()
              }
            }}
          >
            <strong>拖入视频，或点击选择</strong>
            <p>支持 mp4 / mov / webm 等。建议先用真 Alpha 母带；灰底预览片选「抠色」。</p>
            <input
              id="file-input"
              type="file"
              accept="video/*,.mov,.webm,.mp4"
              hidden
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
          </div>

          {file && (
            <p className="file-meta">
              {file.name} · {formatBytes(file.size)}
            </p>
          )}

          <div className="field">
            <label htmlFor="mode">输出格式</label>
            <select
              id="mode"
              value={mode}
              onChange={(e) => setMode(e.target.value as OutputMode)}
            >
              {MODES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
            </select>
            <p className="hint">{modeMeta.desc}</p>
          </div>

          {mode === 'keyed-webm' && (
            <>
              <div className="field">
                <label htmlFor="key">抠色色值</label>
                <input
                  id="key"
                  type="text"
                  value={keyColor}
                  onChange={(e) => setKeyColor(e.target.value)}
                  placeholder="#8a8a8a"
                />
              </div>
              <div className="row-2">
                <div className="field">
                  <label htmlFor="sim">相似度</label>
                  <input
                    id="sim"
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    value={similarity}
                    onChange={(e) => setSimilarity(Number(e.target.value))}
                  />
                </div>
                <div className="field">
                  <label htmlFor="blend">边缘柔化</label>
                  <input
                    id="blend"
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    value={blend}
                    onChange={(e) => setBlend(Number(e.target.value))}
                  />
                </div>
              </div>
              <p className="hint">盹盹灰底预览默认 #8a8a8a。边缘仍脏就略加大相似度。</p>
            </>
          )}

          <div className="actions">
            <button className="btn btn-primary" disabled={!file || busy} onClick={run}>
              {busy ? '转码中…' : '开始转码'}
            </button>
            {file && (
              <button
                className="btn btn-ghost"
                disabled={busy}
                onClick={() => pickFile(null)}
              >
                清除
              </button>
            )}
          </div>

          <div className="progress" aria-hidden={!busy && progress === 0}>
            <i style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <p className={`status${error ? ' err' : outputs.length ? ' ok' : ''}`}>
            {error || status}
          </p>

          {outputs.length > 0 && (
            <div className="downloads">
              {outputs.map((o) => (
                <div className="download-item" key={o.name}>
                  <span>
                    {o.name}
                    <br />
                    <small style={{ color: 'var(--muted)' }}>{formatBytes(o.blob.size)}</small>
                  </span>
                  <a className="btn btn-ghost" href={o.url} download={o.name}>
                    下载
                  </a>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel">
          <h2>预览</h2>
          <div
            className={`preview-shell${bg === 'checker' ? '' : ' solid'}`}
            style={shellStyle}
          >
            {previewUrl ? (
              <video key={previewUrl} src={previewUrl} controls loop muted playsInline autoPlay />
            ) : (
              <div
                style={{
                  height: '100%',
                  display: 'grid',
                  placeItems: 'center',
                  color: 'var(--muted)',
                  padding: '1rem',
                  textAlign: 'center',
                }}
              >
                选择视频后在此预览。棋盘格可检查透明是否干净。
              </div>
            )}
          </div>
          <div className="preview-bar">
            {(
              [
                ['checker', '棋盘格'],
                ['#5b4a8a', '紫底'],
                ['#0d0d0f', '墨黑'],
                ['#e8e4dc', '浅底'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`chip${bg === id ? ' active' : ''}`}
                onClick={() => setBg(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="hint">
            说明：浏览器无法导出 Apple HEVC+Alpha。有真 Alpha 的 WebM / 双片后，可在 Mac 上再用
            Compressor 或 ffmpeg VideoToolbox 转 iOS 上线带。
          </p>
        </section>
      </div>

      <p className="footer-note">
        Transcode Alpha · 开源本地工具。不收集文件，不连自有服务器。HEVC with Alpha
        属平台能力，请在 macOS 本机二次转码。
      </p>
    </div>
  )
}
