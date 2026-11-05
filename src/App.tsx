import { useCallback, useMemo, useState } from 'react'
import { convertVideo, PLATFORMS, planFor, type Platform } from './lib/ffmpeg'

type BgMode = 'checker' | '#5b4a8a' | '#0d0d0f' | '#e8e4dc'

type OutFile = { name: string; blob: Blob; mime: string; url: string }

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

export default function App() {
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [platform, setPlatform] = useState<Platform>('ios')
  const [keyBackground, setKeyBackground] = useState(false)
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

  const plan = useMemo(() => planFor(platform), [platform])

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
    setStatus('加载 ffmpeg…')
    setProgress(0)
    revokeOutputs(outputs)
    setOutputs([])

    try {
      const result = await convertVideo(file, {
        platform,
        keyBackground,
        keyColor,
        similarity,
        blend,
        onProgress: (r) => {
          setProgress(r)
          setStatus(`转码中 ${Math.round(r * 100)}%`)
        },
      })
      const next = result.files.map((f) => ({
        ...f,
        url: URL.createObjectURL(f.blob),
      }))
      setOutputs(next)
      setProgress(1)
      setStatus(
        `完成 · ${next.map((f) => formatBytes(f.blob.size)).join(' / ')}`,
      )
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
        <p className="tagline">选平台，本地转透明格式。</p>
      </header>

      <div className="layout">
        <section className="panel">
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
            <strong>{file ? file.name : '拖入或选择视频'}</strong>
            <p>{file ? formatBytes(file.size) : 'mp4 / mov / webm · 默认按透明母带处理'}</p>
            <input
              id="file-input"
              type="file"
              accept="video/*,.mov,.webm,.mp4"
              hidden
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
          </div>

          <div className="field">
            <label>目标平台</label>
            <div className="platform-grid" role="radiogroup" aria-label="目标平台">
              {PLATFORMS.map((p) => (
                <button
                  key={p.platform}
                  type="button"
                  role="radio"
                  aria-checked={platform === p.platform}
                  className={`platform-card${platform === p.platform ? ' active' : ''}`}
                  onClick={() => setPlatform(p.platform)}
                >
                  <strong>{p.title}</strong>
                  <span>{p.outputLabel}</span>
                </button>
              ))}
            </div>
          </div>

          <label className="check-row">
            <input
              type="checkbox"
              checked={keyBackground}
              onChange={(e) => setKeyBackground(e.target.checked)}
            />
            <span>灰底 / 绿幕需先抠色</span>
          </label>

          {keyBackground && (
            <div className="key-opts">
              <div className="field">
                <label htmlFor="key">色值</label>
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
                  <label htmlFor="blend">柔化</label>
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
            </div>
          )}

          <div className="actions">
            <button className="btn btn-primary" disabled={!file || busy} onClick={run}>
              {busy ? '转码中…' : `转为 ${plan.title}`}
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

          {(busy || progress > 0 || error || status) && (
            <>
              <div className="progress" aria-hidden={!busy && progress === 0}>
                <i style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
              <p className={`status${error ? ' err' : outputs.length ? ' ok' : ''}`}>
                {error || status}
              </p>
            </>
          )}

          {outputs.length > 0 && (
            <div className="downloads">
              {outputs.map((o) => (
                <div className="download-item" key={o.name}>
                  <span>
                    {o.name}
                    <small>{formatBytes(o.blob.size)}</small>
                  </span>
                  <a className="btn btn-ghost" href={o.url} download={o.name}>
                    下载
                  </a>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel preview-panel">
          <div
            className={`preview-shell${bg === 'checker' ? '' : ' solid'}`}
            style={shellStyle}
          >
            {previewUrl ? (
              <video key={previewUrl} src={previewUrl} controls loop muted playsInline autoPlay />
            ) : (
              <div className="preview-empty">棋盘格 = 透明</div>
            )}
          </div>
          <div className="preview-bar">
            {(
              [
                ['checker', '透明'],
                ['#5b4a8a', '紫'],
                ['#0d0d0f', '黑'],
                ['#e8e4dc', '浅'],
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
        </section>
      </div>
    </div>
  )
}
