/**
 * browser-rtmp-streamer
 * ヘッドレスブラウザで指定URLを閲覧し、ページ内の音声(BGM/SE)ごと
 * 複数のRTMP/RTMPSサーバーへ同時配信する
 *
 * 音声キャプチャ方式:
 *   Linux  → PulseAudio 仮想シンク (null-sink) を作成し、
 *             Chromium の音声出力をそこへルーティングして FFmpeg で録音
 *   macOS  → BlackHole / Soundflower 等の仮想デバイス名を
 *             config.audioDevice に指定
 *
 * 依存 (npm): puppeteer, fluent-ffmpeg, winston
 * 依存 (sys): ffmpeg, pulseaudio (Linux) または BlackHole (macOS)
 */

import puppeteer from "puppeteer";
import ffmpeg from "fluent-ffmpeg";
import { PassThrough } from "stream";
import { execSync, spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import logger from "./logger.js";
import { config } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ======================================================
// PulseAudio 仮想シンクのセットアップ (Linux のみ)
// ======================================================

const SINK_NAME = "browser_stream_sink";

/**
 * PulseAudio に null-sink を作成し、そのモニターソース名を返す。
 * すでに同名シンクがあれば既存のものを使う。
 * @returns {string} モニターソース名 (例: "browser_stream_sink.monitor")
 */
function setupPulseSink() {
  try {
    // 既存シンクを確認
    const list = execSync("pactl list short sinks", { encoding: "utf8" });
    if (list.includes(SINK_NAME)) {
      logger.info(`PulseAudio シンク "${SINK_NAME}" は既に存在します`);
    } else {
      execSync(
        `pactl load-module module-null-sink sink_name=${SINK_NAME} ` +
        `sink_properties=device.description=${SINK_NAME}`,
        { encoding: "utf8" }
      );
      logger.info(`PulseAudio 仮想シンク "${SINK_NAME}" を作成しました`);
    }
    return `${SINK_NAME}.monitor`;
  } catch (err) {
    logger.warn("PulseAudio セットアップ失敗 (Linux 以外、または pactl 未インストール):", err.message);
    return null;
  }
}

// ======================================================
// ブラウザキャプチャ
// ======================================================

/**
 * Puppeteer でページを開き、定期スクリーンショットを MJPEG ストリームへ流す。
 * Linux では Chromium の音声を仮想シンクへルーティングするフラグを付加する。
 *
 * @param {PassThrough} videoStream - MJPEG フレームの書き込み先
 * @param {string|null} pulseMonitor - PulseAudio モニターソース名
 */
async function startBrowserCapture(videoStream, pulseMonitor) {
  const extraArgs = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-gpu",
    "--autoplay-policy=no-user-gesture-required", // 自動再生を許可
    `--window-size=${config.width},${config.height}`,
  ];

  // Linux: Chromium の音声出力を仮想シンクへ向ける
  if (pulseMonitor) {
    extraArgs.push(`--alsa-output-device=pulse`);
    // PULSE_SINK 環境変数で出力先を指定
    process.env.PULSE_SINK = SINK_NAME;
    logger.info(`Chromium の音声を PulseAudio シンク "${SINK_NAME}" へルーティング`);
  }

  const browser = await puppeteer.launch({
    headless: "new",
    args: extraArgs,
    defaultViewport: { width: config.width, height: config.height },
    env: { ...process.env }, // PULSE_SINK を引き継ぐ
  });

  const page = await browser.newPage();

  // ミュートを解除 (headless はデフォルトでミュート)
  const cdp = await page.createCDPSession();
  await cdp.send("Emulation.setAutomationOverride", { enabled: false }).catch(() => { });
  await page.evaluate(() => {
    // Web Audio コンテキストのサスペンドを防ぐ
    Object.defineProperty(document, "hidden", { value: false });
    Object.defineProperty(document, "visibilityState", { value: "visible" });
  });

  logger.info(`ページを開いています: ${config.url}`);
  await page.goto(config.url, { waitUntil: "networkidle2", timeout: 30000 });
  logger.info("ページ読み込み完了");

  let frameCount = 0;
  const intervalMs = 500 / config.fps;

  const captureLoop = setInterval(async () => {
    try {
      const jpeg = await page.screenshot({ type: "jpeg", quality: config.jpegQuality });
      videoStream.write(jpeg);
      frameCount++;
      if (frameCount % (config.fps * 10) === 0) {
        logger.debug(`フレーム数: ${frameCount}`);
      }
    } catch (err) {
      logger.error("スクリーンショット取得エラー:", err.message);
    }
  }, intervalMs);

  const shutdown = async () => {
    logger.info("シャットダウン中...");
    clearInterval(captureLoop);
    videoStream.end();
    await browser.close();
    logger.info("ブラウザを終了しました");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return { browser, captureLoop };
}

// ======================================================
// FFmpeg: 映像 + 音声 → H.264/AAC → 複数 RTMP/RTMPS へ tee
// ======================================================

/**
 * 映像ストリームと音声ソース (PulseAudio モニター or ダミー) を合成し、
 * tee muxer で複数 RTMP/RTMPS サーバーへプッシュする。
 *
 * RTMPS (rtmps://) の場合、tee 出力に tls_verify=0 を自動付加する。
 * ターゲットごとに options プロパティで追加のプロトコルオプションを指定可能。
 *
 * FFmpeg の入力構成:
 *   入力0: MJPEG パイプ (映像)
 *   入力1: PulseAudio モニター  or  lavfi anullsrc (音声)
 *
 * @param {PassThrough} videoStream
 * @param {string|null} pulseMonitor - null の場合は無音フォールバック
 */
function startFfmpegPush(videoStream, pulseMonitor) {
  if (!config.rtmpTargets || config.rtmpTargets.length === 0) {
    throw new Error("config.rtmpTargets が空です。少なくとも 1 つ設定してください。");
  }

  const teeOutput = config.rtmpTargets
    .map((t) => {
      const isRtmps = t.url.startsWith("rtmps://");
      // tee セグメントの avio オプションを組み立てる
      const opts = { f: "flv" };
      if (isRtmps && config.tlsVerify === false) {
        opts.tls_verify = "0";
      }
      // ターゲット固有の追加オプション
      if (t.options) {
        Object.assign(opts, t.options);
      }
      const optStr = Object.entries(opts)
        .map(([k, v]) => `${k}=${v}`)
        .join(":");
      return `[${optStr}]${t.url}`;
    })
    .join("|");

  logger.info(`配信先 (${config.rtmpTargets.length} 件):`);
  config.rtmpTargets.forEach((t) => {
    const proto = t.url.startsWith("rtmps://") ? "RTMPS" : "RTMP";
    logger.info(`  - [${t.name}] (${proto}) ${t.url}`);
  });

  // ---- 音声入力の決定 ----
  // 優先順位: config.audioDevice > PulseAudio monitor > lavfi (無音)
  let audioInputArgs;
  let audioSourceLabel;

  if (config.audioDevice) {
    // 手動指定デバイス (macOS BlackHole など)
    audioInputArgs = ["-f", "avfoundation", "-i", `:${config.audioDevice}`];
    audioSourceLabel = `デバイス: ${config.audioDevice}`;
  } else if (pulseMonitor) {
    // Linux PulseAudio モニター
    audioInputArgs = ["-f", "pulse", "-i", pulseMonitor];
    audioSourceLabel = `PulseAudio: ${pulseMonitor}`;
  } else {
    // フォールバック: 無音
    audioInputArgs = ["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100"];
    audioSourceLabel = "無音 (フォールバック)";
  }
  logger.info(`音声ソース: ${audioSourceLabel}`);

  // ---- FFmpeg コマンドを spawn で直接組み立てる ----
  // fluent-ffmpeg は複数の独立した -i を扱いにくいため、ここは引数配列で組む
  const args = [
    // --- 入力0: 映像 (stdin パイプ) ---
    "-re",
    "-f", "mjpeg",
    "-framerate", String(config.fps),
    "-i", "pipe:0",

    // --- 入力1: 音声 ---
    ...audioInputArgs,

    // --- 映像エンコード ---
    "-map", "0:v",
    "-c:v", "libx264",
    "-b:v", config.videoBitrate,
    "-preset", config.x264Preset,
    "-tune", "zerolatency",
    "-profile:v", "baseline",
    "-pix_fmt", "yuv420p",
    "-s", `${config.width}x${config.height}`,
    "-r", String(config.fps),

    // --- 音声エンコード ---
    "-map", "1:a",
    "-c:a", "aac",
    "-b:a", config.audioBitrate,
    "-ar", "44100",
    "-ac", "2",

    // --- 出力: tee muxer ---
    "-f", "tee",
    "-flags", "+global_header",
    teeOutput,
  ];

  logger.debug("FFmpeg args:", args.join(" "));

  const proc = spawn("ffmpeg", args, { stdio: ["pipe", "inherit", "inherit"] });

  // videoStream → ffmpeg の stdin へパイプ
  videoStream.pipe(proc.stdin);

  proc.on("error", (err) => {
    logger.error("FFmpeg プロセスエラー:", err.message);
    process.exit(1);
  });
  proc.on("exit", (code) => {
    if (code !== 0) {
      logger.error(`FFmpeg が終了コード ${code} で終了しました`);
      process.exit(1);
    }
    logger.info("FFmpeg 正常終了");
  });

  logger.info("FFmpeg 起動完了");
  return proc;
}

// ======================================================
// エントリポイント
// ======================================================

async function main() {
  logger.info("=== browser-rtmp-streamer (音声対応版) 起動 ===");
  logger.info(`URL         : ${config.url}`);
  logger.info(`解像度      : ${config.width}x${config.height} @ ${config.fps}fps`);
  logger.info(`映像ビットレート: ${config.videoBitrate}`);
  logger.info(`音声ビットレート: ${config.audioBitrate}`);

  // Linux: PulseAudio 仮想シンクを準備
  const pulseMonitor = process.platform === "linux" ? setupPulseSink() : null;

  // 映像パイプ
  const videoStream = new PassThrough({ highWaterMark: 1024 * 1024 * 4 });

  // FFmpeg を先に起動 (stdin 待ち)
  startFfmpegPush(videoStream, pulseMonitor);

  // ブラウザキャプチャ開始
  await startBrowserCapture(videoStream, pulseMonitor);
}

main().catch((err) => {
  logger.error("起動エラー:", err);
  process.exit(1);
});
