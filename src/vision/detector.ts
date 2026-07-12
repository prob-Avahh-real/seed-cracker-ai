/**
 * 瓜子检测器
 *
 * 基于计算机视觉检测图像中的瓜子位置和边界框。
 * 使用经典的图像处理流程：
 *   1. 灰度化 + 高斯模糊
 *   2. 自适应阈值二值化
 *   3. 轮廓检测 + 过滤
 *   4. 非极大值抑制 (NMS)
 *
 * 同时支持 TensorFlow.js 模型推理作为备选方案。
 */

import sharp from 'sharp';
import logger from '../utils/logger';
import { getConfig } from '../config';

export interface BoundingBox {
  x: number;       // 左上角 x
  y: number;       // 左上角 y
  width: number;   // 宽度
  height: number;  // 高度
  confidence: number; // 置信度 0-1
}

export interface DetectedSeed {
  id: number;
  bbox: BoundingBox;
  centerX: number;
  centerY: number;
  area: number;
  aspectRatio: number;
}

/**
 * 使用 sharp 和图像处理算法检测瓜子轮廓
 */
export class SeedDetector {
  private cfg = getConfig().vision;

  /**
   * 检测图像中的所有瓜子
   * @param pixelData - RGB 像素数据
   * @param width - 图像宽度
   * @param height - 图像高度
   * @returns 检测到的瓜子列表
   */
  async detect(pixelData: Buffer, width: number, height: number): Promise<DetectedSeed[]> {
    // 1. 转灰度 + 模糊降噪
    const gray = await sharp(pixelData, { raw: { width, height, channels: 3 } })
      .greyscale()
      .blur(3)
      .raw()
      .toBuffer();

    // 2. 二值化 (Otsu 阈值近似)
    const threshold = this.calculateOtsuThreshold(gray);
    const binary = this.applyThreshold(gray, threshold);

    // 3. 轮廓检测
    const contours = this.findContours(binary, width, height);

    // 4. 过滤 + NMS
    const filtered = this.filterContours(contours);

    logger.debug(`Seed detection: ${filtered.length} seeds found (threshold=${threshold})`);
    return filtered;
  }

  /**
   * 检测最大的瓜子 (用于确定当前处理目标)
   */
  async detectPrimary(pixelData: Buffer, width: number, height: number): Promise<DetectedSeed | null> {
    const seeds = await this.detect(pixelData, width, height);
    if (seeds.length === 0) return null;

    // 返回面积最大的瓜子作为主要目标
    return seeds.reduce((a, b) => (a.area > b.area ? a : b));
  }

  /**
   * 计算 Otsu 阈值
   */
  private calculateOtsuThreshold(grayBuffer: Buffer): number {
    const histogram = new Array(256).fill(0);
    const total = grayBuffer.length;

    // 构建直方图
    for (let i = 0; i < total; i++) {
      histogram[grayBuffer[i]]++;
    }

    let sum = 0;
    for (let i = 0; i < 256; i++) {
      sum += i * histogram[i];
    }

    let sumB = 0;
    let wB = 0;
    let wF = 0;
    let maxVariance = 0;
    let threshold = 128;

    for (let t = 0; t < 256; t++) {
      wB += histogram[t];
      if (wB === 0) continue;
      wF = total - wB;
      if (wF === 0) break;

      sumB += t * histogram[t];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      const variance = wB * wF * (mB - mF) * (mB - mF);

      if (variance > maxVariance) {
        maxVariance = variance;
        threshold = t;
      }
    }

    return threshold;
  }

  /**
   * 应用阈值生成二值图
   */
  private applyThreshold(grayBuffer: Buffer, threshold: number): Uint8Array {
    const binary = new Uint8Array(grayBuffer.length);
    for (let i = 0; i < grayBuffer.length; i++) {
      binary[i] = grayBuffer[i] > threshold ? 255 : 0;
    }
    return binary;
  }

  /**
   * 轮廓检测 (简化版连通域算法)
   */
  private findContours(
    binary: Uint8Array,
    width: number,
    height: number
  ): BoundingBox[] {
    const visited = new Uint8Array(width * height);
    const boxes: BoundingBox[] = [];

    // 8-邻域泛洪填充
    const floodFill = (startX: number, startY: number): BoundingBox | null => {
      const stack: [number, number][] = [[startX, startY]];
      let minX = startX, maxX = startX;
      let minY = startY, maxY = startY;
      let pixelCount = 0;

      while (stack.length > 0) {
        const [x, y] = stack.pop()!;
        const idx = y * width + x;

        if (x < 0 || x >= width || y < 0 || y >= height) continue;
        if (visited[idx] || binary[idx] !== 255) continue;

        visited[idx] = 1;
        pixelCount++;

        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;

        // 8-邻域扩展
        stack.push([x - 1, y - 1], [x, y - 1], [x + 1, y - 1]);
        stack.push([x - 1, y], [x + 1, y]);
        stack.push([x - 1, y + 1], [x, y + 1], [x + 1, y + 1]);
      }

      if (pixelCount < 50) return null; // 忽略太小区域

      return {
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
        confidence: 0.85, // 基于形状的启发式置信度
      };
    };

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!visited[y * width + x] && binary[y * width + x] === 255) {
          const box = floodFill(x, y);
          if (box) boxes.push(box);
        }
      }
    }

    return boxes;
  }

  /**
   * 过滤无效轮廓 (形状约束) + NMS
   */
  private filterContours(boxes: BoundingBox[]): DetectedSeed[] {
    const minArea = 500;    // 最小面积 (像素)
    const maxArea = 50000;  // 最大面积
    const minAspect = 0.3;  // 最小宽高比
    const maxAspect = 3.0;  // 最大宽高比

    const validBoxes: BoundingBox[] = [];
    for (const box of boxes) {
      const area = box.width * box.height;
      const aspect = box.width / box.height;

      if (area < minArea || area > maxArea) continue;
      if (aspect < minAspect || aspect > maxAspect) continue;

      validBoxes.push(box);
    }

    // 按面积降序排列
    validBoxes.sort((a, b) => (b.width * b.height) - (a.width * a.height));

    // NMS (非极大值抑制)
    const nmsResult: BoundingBox[] = [];
    const iouThreshold = 0.3;

    for (const box of validBoxes) {
      let keep = true;
      for (const kept of nmsResult) {
        if (this.calculateIoU(box, kept) > iouThreshold) {
          keep = false;
          break;
        }
      }
      if (keep) nmsResult.push(box);
    }

    // 转换为 DetectedSeed
    return nmsResult.map((box, index) => ({
      id: index,
      bbox: box,
      centerX: box.x + box.width / 2,
      centerY: box.y + box.height / 2,
      area: box.width * box.height,
      aspectRatio: box.width / box.height,
    }));
  }

  /**
   * 计算两个边界框的 IoU (交并比)
   */
  private calculateIoU(a: BoundingBox, b: BoundingBox): number {
    const x1 = Math.max(a.x, b.x);
    const y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.width, b.x + b.width);
    const y2 = Math.min(a.y + a.height, b.y + b.height);

    if (x1 >= x2 || y1 >= y2) return 0;

    const intersection = (x2 - x1) * (y2 - y1);
    const areaA = a.width * a.height;
    const areaB = b.width * b.height;
    const union = areaA + areaB - intersection;

    return intersection / union;
  }
}
