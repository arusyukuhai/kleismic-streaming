/**
 * logger.js — winston ベースのロガー
 */
import { createLogger, format, transports } from "winston";

const { combine, timestamp, colorize, printf } = format;

const logFormat = printf(({ level, message, timestamp, ...meta }) => {
  const extra = Object.keys(meta).length ? " " + JSON.stringify(meta) : "";
  return `${timestamp} [${level}] ${message}${extra}`;
});

const logger = createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: combine(
    timestamp({ format: "HH:mm:ss.SSS" }),
    colorize(),
    logFormat
  ),
  transports: [new transports.Console()],
});

export default logger;
