# browser-rtmp-streamer

ヘッドレスブラウザ (Puppeteer) で任意のウェブページを閲覧し、
FFmpeg の tee muxer を使って **複数の RTMP サーバーへ同時配信** し続けるツールです。

## アーキテクチャ

```
Puppeteer (headless Chrome)
  │  スクリーンショット (JPEG) を fps レートで連続取得
  │
  ▼
PassThrough (Node.js stream)
  │  MJPEG ストリームとして流す
  │
  ▼
FFmpeg
  │  libx264 でエンコード + AAC 無音
  │  tee muxer で分岐
  │
  ├──► RTMP サーバー 1 (YouTube など)
  ├──► RTMP サーバー 2 (Twitch など)
  └──► RTMP サーバー N (任意追加)
```

## 必要なシステム要件

| 依存 | バージョン |
|------|----------|
| Node.js | >= 18 |
| ffmpeg | システムインストール (`apt install ffmpeg` など) |
| Chrome / Chromium | Puppeteer が自動ダウンロード |

## セットアップ

```bash
# 依存インストール
npm install

# ffmpeg が入っているか確認
ffmpeg -version
```

## 設定

### 方法 1: config.js を直接編集

```js
// config.js
export const config = {
  url: "https://your-page.example.com",
  rtmpTargets: [
    { name: "YouTube", url: "rtmp://a.rtmp.youtube.com/live2/YOUR_KEY" },
    { name: "Twitch",  url: "rtmp://live.twitch.tv/app/YOUR_KEY" },
  ],
  // ...
};
```

### 方法 2: 環境変数でオーバーライド

```bash
export STREAM_URL="https://your-page.example.com"
export RTMP_TARGETS='[
  {"name":"YouTube","url":"rtmp://a.rtmp.youtube.com/live2/YOUR_KEY"},
  {"name":"Twitch","url":"rtmp://live.twitch.tv/app/YOUR_KEY"}
]'
export WIDTH=1920
export HEIGHT=1080
export FPS=30
export VIDEO_BITRATE=6000k
export X264_PRESET=veryfast
```

## 起動

```bash
# 通常起動
npm start

# デバッグログあり
npm run dev
```

## 環境変数一覧

| 変数 | デフォルト | 説明 |
|------|-----------|------|
| `STREAM_URL` | `https://example.com` | 配信するページの URL |
| `WIDTH` | `1280` | 解像度 (幅) |
| `HEIGHT` | `720` | 解像度 (高さ) |
| `FPS` | `30` | フレームレート |
| `JPEG_QUALITY` | `90` | スクリーンショット品質 (1–100) |
| `VIDEO_BITRATE` | `3000k` | 映像ビットレート |
| `X264_PRESET` | `veryfast` | x264 エンコードプリセット |
| `RTMP_TARGETS` | YouTube/Twitch サンプル | JSON 配列でRTMP先を指定 |
| `LOG_LEVEL` | `info` | ログレベル (debug/info/warn/error) |

## 終了

`Ctrl+C` (SIGINT) または `kill <PID>` (SIGTERM) でブラウザ・FFmpeg を安全に終了します。

## トラブルシューティング

### `ffmpeg: command not found`
```bash
# Ubuntu/Debian
sudo apt install ffmpeg

# macOS
brew install ffmpeg
```

### ページが正しく読み込まれない
- `STREAM_URL` が正しいか確認
- SPA の場合は `waitUntil: "networkidle2"` のタイムアウトを延ばす
- Basic 認証が必要なページは `page.authenticate()` を stream.js に追加

### CPU 使用率が高い
- `FPS` を下げる (例: 15)
- `X264_PRESET` を `ultrafast` にする
- `JPEG_QUALITY` を下げる (例: 75)
