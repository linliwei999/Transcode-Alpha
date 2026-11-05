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
  const [keyBackground, setKeyBackground] = useState(true)
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
    setStatus('正在加载 ffmpeg（首次约几十秒）…')
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
          setStatus(`转码中（${plan.title} → ${plan.outputLabel}）… ${Math.round(r * 100)}%`)
        },
      })
      const next = result.files.map((f) => ({
        ...f,
        url: URL.createObjectURL(f.blob),
      }))
      setOutputs(next)
      setProgress(1)
      setStatus(
        `完成 · ${result.plan.title} · ${result.plan.outputLabel} · ${next
          .map((f) => formatBytes(f.blob.size))
          .join(' / ')}`,
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
        <p className="tagline">
          选好目标平台，自动转成能用的透明方案。全部在浏览器本地完成，文件不上传。
        </p>
        <div className="badge-row">
          <span className="badge">选平台即转</span>
          <span className="badge">本地 ffmpeg.wasm</span>
          <span className="badge">灰底可抠色</span>
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
            <p>mp4 / mov / webm。真 Alpha 母带或灰底预览片都可以。</p>
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
            <p className="hint">{plan.desc}</p>
          </div>

          <label className="check-row">
            <input
              type="checkbox"
              checked={keyBackground}
              onChange={(e) => setKeyBackground(e.target.checked)}
            />
            <span>
              源片是实心底（灰底 / 绿幕），先抠色再导出
              <small>外包预览片常见；真透明母带请关掉</small>
            </span>
          </label>

          {keyBackground && (
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
              {busy ? '转码中…' : `转为 ${plan.title} 格式`}
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
            选 iOS / 鸿蒙 / 三端通用会得到两路 MP4：把 <code>mask</code> 当透明度叠在{' '}
            <code>color</code> 上即可。选安卓 / 网页则是单文件透明 WebM。
          </p>
        </section>
      </div>

      <p className="footer-note">
        Transcode Alpha · 开源本地工具。选平台即可用；浏览器无法调用 Mac 的 HEVC+Alpha
        编码器，故 iOS 走双片方案，不必再开终端。
      </p>
    </div>
  )
}
