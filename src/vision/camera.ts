/**
 * 摄像头采集模块
 *
 * 封装 node-webcam，提供统一的图像捕获接口。
 * 支持内置摄像头和 USB 外接摄像头。
 */

import * as NodeWebcam from 'node-webcam';
import * as path from 'path';
import * as fs from 'fs';
import sharp from 'sharp';
import logger from '../utils/logger';
import { getConfig } from '../config';

export interface CaptureResult {
  /** 图像文件路径 */
  filePath: string;
  /** 原始 RGB 像素数据 Buffer */
  pixelData: Buffer;
  /** 图像宽度 */
  width: number;
  /** 图像高度 */
  height: number;
  /** 通道数 (3 for RGB) */
  channels: number;
  /** 捕获时间戳 */
  timestamp: number;
}

export class CameraCapture {
  private webcam: NodeWebcam.Webcam;
  private outputDir: string;
  private isRunning = false;

  constructor() {
    const cfg = getConfig().vision;
    this.outputDir = path.join(process.cwd(), 'captures');

    // 确保输出目录存在
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }

    this.webcam = NodeWebcam.create({
      width: cfg.width,
      height: cfg.height,
      quality: 100,
      delay: 0,
      saveShots: true,
      output: 'jpeg',
      device: cfg.cameraDevice,
      callbackReturn: 'location',
      verbose: false,
    });

    logger.info(`Camera initialized: ${cfg.width}x${cfg.height}, device=${cfg.cameraDevice}`);
  }

  /**
   * 捕获一帧图像
   */
  async capture(): Promise<CaptureResult> {
    return new Promise((resolve, reject) => {
      const filename = `seed_${Date.now()}.jpg`;
      const filePath = path.join(this.outputDir, filename);

      this.webcam.capture(filePath, async (err: Error | null, data?: string) => {
        if (err) {
          logger.error('Camera capture failed:', err);
          return reject(err);
        }

        try {
          // 读取图像并提取原始像素数据
          const image = sharp(filePath);
          const metadata = await image.metadata();
          const pixelData = await image
            .ensureAlpha()
            .raw()
            .toBuffer();

          const result: CaptureResult = {
            filePath: data || filePath,
            pixelData,
            width: metadata.width || getConfig().vision.width,
            height: metadata.height || getConfig().vision.height,
            channels: metadata.channels || 3,
            timestamp: Date.now(),
          };

          logger.debug(`Frame captured: ${result.width}x${result.height}, ${pixelData.length} bytes`);
          resolve(result);
        } catch (sharpErr) {
          reject(sharpErr);
        }
      });
    });
  }

  /**
   * 连续捕获多帧 (用于运动检测或采样)
   * @param count 帧数
   * @param intervalMs 帧间隔
   */
  async captureBurst(count: number, intervalMs: number = 100): Promise<CaptureResult[]> {
    const frames: CaptureResult[] = [];
    for (let i = 0; i < count; i++) {
      const frame = await this.capture();
      frames.push(frame);
      if (i < count - 1) {
        await this.delay(intervalMs);
      }
    }
    return frames;
  }

  /**
   * 清理旧的捕获文件 (保留最近 N 个)
   */
  cleanup(maxFiles: number = 50): void {
    try {
      const files = fs.readdirSync(this.outputDir)
        .filter((f) => f.startsWith('seed_'))
        .map((f) => ({
          name: f,
          time: fs.statSync(path.join(this.outputDir, f)).mtimeMs,
        }))
        .sort((a, b) => b.time - a.time);

      if (files.length > maxFiles) {
        for (const file of files.slice(maxFiles)) {
          fs.unlinkSync(path.join(this.outputDir, file.name));
        }
        logger.debug(`Cleaned up ${files.length - maxFiles} old captures`);
      }
    } catch {
      // 静默处理清理错误
    }
  }

  /**
   * 获取摄像头列表
   */
  static async listDevices(): Promise<NodeWebcam.WebcamInfo[]> {
    return new Promise((resolve) => {
      NodeWebcam.Factory.list((list: NodeWebcam.WebcamInfo[]) => {
        resolve(list);
      });
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
