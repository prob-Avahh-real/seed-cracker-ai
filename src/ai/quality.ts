/**
 * 质量评估模块
 *
 * 开壳后评估瓜子是否成功裂开、壳仁分离度等。
 * 用于决定是否需要重试开壳。
 */

import sharp from 'sharp';
import logger from '../utils/logger';
import { getConfig } from '../config';

export interface CrackQuality {
  /** 开壳是否成功 */
  success: boolean;
  /** 壳仁分离度 (0-1) */
  separationScore: number;
  /** 是否完整 (仁未碎) */
  kernelIntact: boolean;
  /** 详细原因 */
  reason: string;
}

export class QualityAssessor {
  private cfg = getConfig().ai;

  /**
   * 评估开壳质量
   * 通过比较开壳前后的图像差异来判断
   */
  async assess(
    beforePixelData: Buffer,
    afterPixelData: Buffer,
    width: number,
    height: number
  ): Promise<CrackQuality> {
    // 计算前后差异
    const diffScore = await this.calculateDifference(beforePixelData, afterPixelData, width, height);

    // 壳仁分离度评估
    let separationScore: number;
    let kernelIntact = true;
    let reason = '';

    if (diffScore < 0.05) {
      // 几乎没有变化 → 未裂开
      separationScore = 0.1;
      reason = 'no visible crack - shell intact';
    } else if (diffScore < 0.15) {
      // 轻微变化 → 部分裂开
      separationScore = 0.5;
      reason = 'partial crack - may need retry';
    } else if (diffScore > 0.4) {
      // 变化过大 → 可能压碎
      separationScore = 0.3;
      kernelIntact = false;
      reason = 'over-cracked - kernel may be crushed';
    } else {
      // 适当的变化 → 成功
      separationScore = Math.min(diffScore * 3, 1.0);
      reason = 'successfully cracked';
    }

    const success = separationScore >= this.cfg.separationThreshold && kernelIntact;

    logger.debug(
      `Quality: success=${success}, separation=${separationScore.toFixed(3)}, ` +
      `diff=${diffScore.toFixed(3)}, intact=${kernelIntact}`
    );

    return { success, separationScore, kernelIntact, reason };
  }

  /**
   * 快速判断：仅基于压力传感器数据
   */
  assessByPressure(beforePressure: number, afterPressure: number): CrackQuality {
    const drop = beforePressure - afterPressure;
    const dropRatio = drop / Math.max(beforePressure, 1);

    let success: boolean;
    let separationScore: number;
    let kernelIntact: boolean;
    let reason: string;

    if (dropRatio < 0.1) {
      success = false;
      separationScore = 0.1;
      kernelIntact = true;
      reason = 'insufficient pressure drop - shell not cracked';
    } else if (dropRatio > 0.8) {
      success = false;
      separationScore = 0.2;
      kernelIntact = false;
      reason = 'excessive pressure drop - kernel likely crushed';
    } else {
      success = true;
      separationScore = dropRatio;
      kernelIntact = true;
      reason = `pressure drop ${(dropRatio * 100).toFixed(0)}% - crack successful`;
    }

    return { success, separationScore, kernelIntact, reason };
  }

  /**
   * 计算两帧图像的差异分数
   */
  private async calculateDifference(
    before: Buffer,
    after: Buffer,
    width: number,
    height: number
  ): Promise<number> {
    // 转灰度
    const grayBefore = await sharp(before, { raw: { width, height, channels: 3 } })
      .greyscale().raw().toBuffer();
    const grayAfter = await sharp(after, { raw: { width, height, channels: 3 } })
      .greyscale().raw().toBuffer();

    let totalDiff = 0;
    for (let i = 0; i < grayBefore.length; i++) {
      totalDiff += Math.abs(grayBefore[i] - grayAfter[i]);
    }

    return totalDiff / (grayBefore.length * 255);
  }
}
