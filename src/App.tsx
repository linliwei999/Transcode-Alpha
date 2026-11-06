import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { convertVideo, PLATFORMS, planFor, type Platform } from './lib/ffmpeg'

type BgMode = 'checker' | '#5b4a8a' | '#0d0d0f' | '#e8e4dc'

type OutFile = { name: string; blob: Blob; mime: string; url: string }

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

function extOfName(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i) : ''
}

/** 保留原后缀；用户只改主名 */
function withOriginalExt(input: string, originalName: string): string {
  const ext = extOfName(originalName) || '.mp4'
  const trimmed = input.trim() || originalName
  const stem = trimmed.replace(/\.[^./\\]+$/i, '') || 'output'
  return `${stem}${ext}`
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
      <path
        fill="currentColor"
        d="M12 3a1 1 0 0 1 1 1v9.59l2.3-2.3a1 1 0 1 1 1.4 1.42l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.42L11 13.59V4a1 1 0 0 1 1-1Zm-7 14a1 1 0 0 1 1 1v1h12v-1a1 1 0 1 1 2 0v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1Z"
      />
    </svg>
  )
}

function CircularProgress({ value }: { value: number }) {
  const r = 34
  const c = 2 * Math.PI * r
  const pct = Math.min(1, Math.max(0, value))
  return (
    <div className="circ-progress" role="progressbar" aria-valuenow={Math.round(pct * 100)}>
      <svg viewBox="0 0 80 80" width="80" height="80">
        <circle className="circ-track" cx="40" cy="40" r={r} />
        <circle
          className="circ-fill"
          cx="40"
          cy="40"
          r={r}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
        />
      </svg>
      <span>{Math.round(pct * 100)}%</span>
    </div>
  )
}

function PreviewPane({
  title,
  emptyLabel,
  file,
  fallbackUrl,
  fallbackHint,
  shellClass = '',
  shellStyle,
  busy = false,
  progress = 0,
}: {
  title: string
  emptyLabel: string
  file: OutFile | null
  fallbackUrl?: string | null
  fallbackHint?: string
  shellClass?: string
  shellStyle?: CSSProperties
  busy?: boolean
  progress?: number
}) {
  const [downloadName, setDownloadName] = useState('')
  const src = !busy ? (file?.url ?? fallbackUrl ?? null) : null
  const ready = Boolean(file && !busy)

  useEffect(() => {
    setDownloadName(file?.name ?? '')
  }, [file?.name, file?.url])

  const finalName = file ? withOriginalExt(downloadName, file.name) : ''

  return (
    <div className={`preview-pane${busy ? ' is-generating' : ''}`}>
      <div className={`preview-shell${shellClass}${busy ? ' generating' : ''}`} style={shellStyle}>
        {busy && (
          <>
            <div className="gen-glow" aria-hidden />
            <div className="gen-shimmer" aria-hidden />
            <div className="gen-scan" aria-hidden />
            <div className="gen-overlay">
              <CircularProgress value={progress} />
              <p className="gen-label">转码中</p>
            </div>
          </>
        )}
        {!busy && src ? (
          <video key={src} src={src} controls loop muted playsInline autoPlay />
        ) : !busy ? (
          <div className="preview-empty">{emptyLabel}</div>
        ) : null}
      </div>
      <div className={`pane-meta${ready ? '' : ' pane-meta-slot'}`}>
        <div className="pane-meta-text">
          {ready && file ? (
            <>
              <label className="sr-only" htmlFor={`dl-${file.name}`}>
                下载文件名
              </label>
              <input
                id={`dl-${file.name}`}
                className="pane-name-input"
                value={downloadName}
                onChange={(e) => setDownloadName(e.target.value)}
                spellCheck={false}
                title="自定义下载文件名（后缀自动保留）"
              />
              <small>{formatBytes(file.blob.size)}</small>
            </>
          ) : (
            <>
              <strong>{title}</strong>
              <small>
                {busy
                  ? `转码中 ${Math.round(progress * 100)}%`
                  : fallbackUrl
                    ? fallbackHint ?? '待转码'
                    : '转完后可下载'}
              </small>
            </>
          )}
        </div>
        {ready && file ? (
          <a
            className="icon-btn"
            href={file.url}
            download={finalName}
            title={`下载 ${finalName}`}
            aria-label={`下载 ${finalName}`}
          >
            <DownloadIcon />
          </a>
        ) : (
          <span className="icon-btn download-slot-btn" aria-hidden>
            <DownloadIcon />
          </span>
        )}
      </div>
    </div>
  )
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

  const colorOut = useMemo(
    () => outputs.find((o) => /-color\./i.test(o.name)) ?? null,
    [outputs],
  )
  const maskOut = useMemo(
    () => outputs.find((o) => /-mask\./i.test(o.name)) ?? null,
    [outputs],
  )
  /** 双片平台：右侧固定左右分栏预览（转完才有片源） */
  const showDualSlots = plan.kind === 'dual-mp4'

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
      // 保留源片；结果信息与下载挂在对应预览下方
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      setStatus('')
    } finally {
      setBusy(false)
    }
  }

  const shellStyle: CSSProperties | undefined =
    bg === 'checker'
      ? undefined
      : { backgroundColor: bg, backgroundImage: 'none' }

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

          <p className={`status status-inline${error ? ' err' : outputs.length ? ' ok' : ''}`}>
            {error || (!busy && status) || '\u00a0'}
          </p>
        </section>

        <section className="panel preview-panel">
          {showDualSlots ? (
            <div className="preview-dual">
              <PreviewPane
                title="画面 · color"
                emptyLabel="画面"
                file={colorOut}
                fallbackUrl={previewUrl}
                fallbackHint="源片（转完后换 color）"
                shellClass={bg === 'checker' ? '' : ' solid'}
                shellStyle={shellStyle}
                busy={busy}
                progress={progress}
              />
              <PreviewPane
                title="遮罩 · mask"
                emptyLabel="遮罩 · 待转码"
                file={maskOut}
                shellClass=" solid preview-mask"
                busy={busy}
                progress={progress}
              />
            </div>
          ) : (
            <PreviewPane
              title="透明片 · alpha"
              emptyLabel="棋盘格 = 透明"
              file={outputs[0] ?? null}
              fallbackUrl={previewUrl}
              fallbackHint="源片"
              shellClass={bg === 'checker' ? '' : ' solid'}
              shellStyle={shellStyle}
              busy={busy}
              progress={progress}
            />
          )}
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
