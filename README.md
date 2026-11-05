# Transcode Alpha

把带透明通道的动作视频，转成各端能用的格式。

**选好目标平台 → 自动导出。** 浏览器本地转码（ffmpeg.wasm），文件不上传。

## 选平台会得到什么

| 目标平台 | 自动导出 |
|---|---|
| **iOS** | 双片 MP4（`color` + `mask`） |
| **安卓** | VP9 Alpha · WebM |
| **鸿蒙** | 双片 MP4 |
| **三端通用** | 双片 MP4 |
| **网页** | VP9 Alpha · WebM |

可选：**源片是灰底/绿幕时先抠色**（外包预览片常用）。

> 浏览器即使跑在 Mac 上，也调用不了系统的 HEVC+Alpha 编码器。iOS 因此用双片方案，App 内把遮罩当透明度叠上去即可，不必再开终端。

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
