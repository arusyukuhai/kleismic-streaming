/**
 * config.js — 配信設定
 * 環境変数でオーバーライド可能
 */

export const config = {
  // ---- ブラウザ ----
  /** 配信するページの URL */
  url: process.env.STREAM_URL || "https://kleismic.com/__tl",

  // ---- 映像 ----
  width: parseInt(process.env.WIDTH || "1280"),
  height: parseInt(process.env.HEIGHT || "720"),
  fps: parseInt(process.env.FPS || "60"),
  /** Puppeteer screenshot JPEG 品質 (1–100) */
  jpegQuality: parseInt(process.env.JPEG_QUALITY || "70"),

  // ---- エンコード: 映像 ----
  videoBitrate: process.env.VIDEO_BITRATE || "3000k",
  /** x264 プリセット: ultrafast / superfast / veryfast / faster / fast / medium */
  x264Preset: process.env.X264_PRESET || "veryfast",

  // ---- エンコード: 音声 ----
  audioBitrate: process.env.AUDIO_BITRATE || "128k",

  /**
   * 音声キャプチャデバイス (省略時は自動選択)
   *
   * Linux:
   *   省略すると PulseAudio 仮想シンク (null-sink) を自動作成してキャプチャ。
   *   手動指定したい場合は PulseAudio ソース名を入れる。
   *   例: "browser_stream_sink.monitor"
   *
   * macOS:
   *   BlackHole や Soundflower の仮想デバイス番号を入れる。
   *   `ffmpeg -f avfoundation -list_devices true -i ""` で番号を確認。
   *   例: "1"  (BlackHole 2ch が入力デバイス 1 の場合)
   *
   * null / 未設定:
   *   Linux → PulseAudio 自動セットアップ
   *   その他 → 無音フォールバック
   */
  audioDevice: process.env.AUDIO_DEVICE || null,

  // ---- TLS (RTMPS) ----
  /**
   * RTMPS 接続時の TLS 証明書検証。
   * false にすると tee 出力に tls_verify=0 を付加し、
   * 自己署名証明書や検証エラーをスキップする (多くの配信サービスで必要)。
   * 環境変数 TLS_VERIFY=1 で有効化可能。
   */
  tlsVerify: process.env.TLS_VERIFY === "1" ? true : false,

  // ---- RTMP / RTMPS 配信先 ----
  /**
   * 複数の RTMP / RTMPS サーバーを列挙する。
   * 環境変数 RTMP_TARGETS に JSON 文字列を渡してオーバーライド可能:
   *   RTMP_TARGETS='[{"name":"YouTube","url":"rtmp://a.rtmp.youtube.com/live2/YOUR_KEY"}]'
   *
   * 各ターゲットに options プロパティを指定すると、
   * tee セグメントの avio オプションとして追加される。
   * 例: { name: "Kick", url: "rtmps://...", options: { tls_verify: "0" } }
   */
  rtmpTargets: process.env.RTMP_TARGETS
    ? JSON.parse(process.env.RTMP_TARGETS)
    : [
      {
        name: "YouTube",
        url: "rtmp://a.rtmp.youtube.com/live2/cm5g-9r54-0qfz-pw26-3a43",
      },
      {
        name: "Twitch",
        url: "rtmp://live-tyo.twitch.tv/app/live_1117999658_g4kFHnN0YstSVjCWCnrbwsVjQmuacv",
      },
      {
        name: "Kick",
        url: "rtmps://fa723fc1b171.global-contribute.live-video.net/sk_us-west-2_BklK1srlegSX_GIdBDRIvbfRMLqYIgVQlywgulB9YDt",
      },
      // 必要に応じて追加
      // { name: "Custom", url: "rtmp://your-server.example.com/live/key" },
      // { name: "Custom RTMPS", url: "rtmps://your-server.example.com/live/key" },
    ],
};
