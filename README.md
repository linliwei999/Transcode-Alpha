# Transcode Alpha

把带透明通道的动作视频，转成各端能用的格式。

浏览器本地转码（ffmpeg.wasm），**文件不上传**。

## 能做什么

| 输出 | 用途 |
|---|---|
| **VP9 Alpha · WebM** | 安卓 / 网页透明视频；也可作再转 iOS 的中间件 |
| **双片 MP4（画面 + 遮罩）** | iOS / 安卓 / 鸿蒙通用；App 内合成透明 |
| **抠色 → VP9 Alpha** | 灰底 / 绿幕预览片抠成透明（外包常交灰底 H.264） |

> 浏览器**不能**直接导出 Apple **HEVC + Alpha**。拿到真 Alpha 的 WebM 后，在 Mac 上用 Compressor / `ffmpeg -c:v hevc_videotoolbox` 再转 iOS 上线带。

## 开发

```bash
npm install
npm run dev
```

需要 COOP/COEP（Vite 已配），否则 SharedArrayBuffer / ffmpeg.wasm 无法加载。

```bash
npm run build
npm run preview
```

## 许可

MIT
