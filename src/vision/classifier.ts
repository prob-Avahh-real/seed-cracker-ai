/**
 * 瓜子方向分类器
 *
 * 判断瓜子的朝向 (尖端朝上 / 尖端朝下)，
 * 用于指导开壳舵机从正确的一侧施加压力。
 *
 * 策略:
 *   1. 基于形状分析 — 计算瓜子轮廓的椭圆拟合，
 *      通过重心偏移判断尖端方向 (启发式，无需模型)
 *   2. TensorFlow.js 模型 — 使用 CNN 模型进行精细分类
 *      (需要预训练模型)
 */

import sharp from 'sharp';
import * as tf from '@tensorflow/tfjs-node';
import * as path from 'path';
import logger from '../utils/logger';
import { getConfig } from '../config';
import { DetectedSeed } from './detector';

export type SeedOrientation = 'tip_up' | 'tip_down' | 'unknown';

export interface OrientationResult {
  orientation: SeedOrientation;
  confidence: number;
  /** 尖端在图像坐标系中的角度 (度，0=↑) */
  tipAngle: number;
  /** 重心偏移比例 (-1 到 1，正值表示重心偏向下方) */
  centerOffsetRatio: number;
}

export interface SeedQuality {
  /** 是否可开壳 (无破损、无发霉) */
  crackable: boolean;
  /** 质量评分 0-100 */
  score: number;
  /** 检测到的问题 */
  defects: string[];
}

/**
 * 基于形状分析的方向分类器 (启发式方法)
 */
export class OrientationClassifier {
  private model: tf.GraphModel | null = null;
  private modelLoaded = false;

  /**
   * 基于形状分析的方向判断 (快速，无需 GPU)
   */
  async classifyByShape(seed: DetectedSeed, pixelData: Buffer, imageWidth: number): Promise<OrientationResult> {
    const { bbox } = seed;

    // 裁切瓜子区域
    const cropBuffer = await sharp(pixelData, {
      raw: { width: imageWidth, height: Math.floor(pixelData.length / (imageWidth * 3)), channels: 3 },
    })
      .extract({
        left: Math.max(0, bbox.x - 5),
        top: Math.max(0, bbox.y - 5),
        width: Math.min(bbox.width + 10, imageWidth - bbox.x),
        height: bbox.height + 10,
      })
      .greyscale()
      .raw()
      .toBuffer();

    // 计算重心偏移
    const cropW = bbox.width + 10;
    const cropH = bbox.height + 10;
    let sumX = 0, sumY = 0, sum = 0;

    for (let y = 0; y < cropH; y++) {
      for (let x = 0; x < cropW; x++) {
        const pixel = cropBuffer[y * cropW + x];
        sumX += x * pixel;
        sumY += y * pixel;
        sum += pixel;
      }
    }

    const centerX = sumX / sum;
    const centerY = sumY / sum;
    const geoCenterX = cropW / 2;
    const geoCenterY = cropH / 2;

    // 重心相对于几何中心的偏移
    const offsetX = (centerX - geoCenterX) / cropW;
    const offsetY = (centerY - geoCenterY) / cropH;

    // 瓜子呈椭圆形状，重心偏移方向即为尖端方向
    const tipAngle = Math.atan2(offsetY, offsetX) * (180 / Math.PI) + 90;
    const magnitude = Math.sqrt(offsetX * offsetX + offsetY * offsetY);

    let orientation: SeedOrientation;
    let confidence: number;

    if (magnitude < 0.02) {
      orientation = 'unknown';
      confidence = 0.3;
    } else {
      // offsetY > 0 表示重心偏下 → 尖端朝上
      orientation = offsetY > 0 ? 'tip_up' : 'tip_down';
      confidence = Math.min(magnitude * 10, 0.95);
    }

    logger.debug(
      `Orientation by shape: ${orientation} (confidence=${confidence.toFixed(3)}, ` +
      `offset=(${offsetX.toFixed(3)}, ${offsetY.toFixed(3)}))`
    );

    return {
      orientation,
      confidence,
      tipAngle: ((tipAngle % 360) + 360) % 360,
      centerOffsetRatio: offsetY,
    };
  }

  /**
   * 基于 TensorFlow.js 模型的分类 (高精度，需要 GPU)
   */
  async classifyByModel(seed: DetectedSeed, pixelData: Buffer, imageWidth: number): Promise<OrientationResult> {
    if (!this.modelLoaded) {
      await this.loadModel();
    }

    if (!this.model) {
      logger.warn('Model not loaded, falling back to shape-based classification');
      return this.classifyByShape(seed, pixelData, imageWidth);
    }

    // 裁切 + resize 到模型输入尺寸 (224x224)
    const cropBuffer = await sharp(pixelData, {
      raw: { width: imageWidth, height: Math.floor(pixelData.length / (imageWidth * 3)), channels: 3 },
    })
      .extract({
        left: Math.max(0, seed.bbox.x - 10),
        top: Math.max(0, seed.bbox.y - 10),
        width: Math.min(seed.bbox.width + 20, imageWidth - seed.bbox.x),
        height: seed.bbox.height + 20,
      })
      .resize(224, 224)
      .raw()
      .toBuffer();

    // 转为 TensorFlow tensor
    const tensor = tf.tensor3d(
      new Float32Array(cropBuffer),
      [224, 224, 3]
    ).expandDims(0).div(255.0);

    const prediction = this.model.predict(tensor) as tf.Tensor;
    const scores = await prediction.data();
    tensor.dispose();
    prediction.dispose();

    // scores[0] = tip_up, scores[1] = tip_down
    const orientation: SeedOrientation = scores[0] > scores[1] ? 'tip_up' : 'tip_down';
    const confidence = Math.max(scores[0], scores[1]);

    return {
      orientation,
      confidence,
      tipAngle: 0,
      centerOffsetRatio: 0,
    };
  }

  /**
   * 评估瓜子质量 (缺陷检测)
   */
  async assessQuality(seed: DetectedSeed, pixelData: Buffer, imageWidth: number): Promise<SeedQuality> {
    const defects: string[] = [];
    let score = 100;

    const { bbox } = seed;
    const cropBuffer = await sharp(pixelData, {
      raw: { width: imageWidth, height: Math.floor(pixelData.length / (imageWidth * 3)), channels: 3 },
    })
      .extract({
        left: Math.max(0, bbox.x),
        top: Math.max(0, bbox.y),
        width: Math.min(bbox.width, imageWidth - bbox.x),
        height: bbox.height,
      })
      .greyscale()
      .raw()
      .toBuffer();

    // 1. 破损检测 — 检查是否有异常暗区/亮区
    const { mean, stdDev } = this.calculateStats(cropBuffer);
    if (stdDev > 80) {
      defects.push('surface_damage');
      score -= 30;
    }

    // 2. 发霉检测 — 检查是否有深色斑点
    let darkSpotCount = 0;
    for (let i = 0; i < cropBuffer.length; i++) {
      if (cropBuffer[i] < mean - 2 * stdDev && cropBuffer[i] < 30) {
        darkSpotCount++;
      }
    }
    if (darkSpotCount > cropBuffer.length * 0.05) {
      defects.push('mold');
      score -= 40;
    }

    // 3. 空壳检测 — 过小的标准差可能意味空壳
    if (stdDev < 15) {
      defects.push('empty_shell');
      score -= 50;
    }

    // 4. 尺寸检查
    if (seed.area < 800) {
      defects.push('too_small');
      score -= 20;
    }

    const crackable = score >= 50 && !defects.includes('empty_shell');

    return { crackable, score: Math.max(0, score), defects };
  }

  /**
   * 加载 TensorFlow.js 模型
   */
  async loadModel(): Promise<void> {
    const modelPath = getConfig().modelPath;
    const fullPath = path.resolve(modelPath);

    try {
      this.model = await tf.loadGraphModel(`file://${fullPath}/model.json`);
      this.modelLoaded = true;
      logger.info(`Orientation model loaded from ${fullPath}`);
    } catch (err) {
      logger.warn(`Failed to load model from ${fullPath}, using shape-based classification`);
      this.modelLoaded = true; // 标记为已尝试，避免重复加载
    }
  }

  private calculateStats(buffer: Buffer): { mean: number; stdDev: number } {
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) {
      sum += buffer[i];
    }
    const mean = sum / buffer.length;

    let variance = 0;
    for (let i = 0; i < buffer.length; i++) {
      variance += (buffer[i] - mean) ** 2;
    }
    const stdDev = Math.sqrt(variance / buffer.length);

    return { mean, stdDev };
  }
}
