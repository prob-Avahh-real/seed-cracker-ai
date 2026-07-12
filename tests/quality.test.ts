/**
 * 质量评估器单元测试
 */

import { QualityAssessor, CrackQuality } from '../src/ai/quality';

describe('QualityAssessor', () => {
  let assessor: QualityAssessor;

  beforeEach(() => {
    assessor = new QualityAssessor();
  });

  test('压力法: 正常开壳判定为成功', () => {
    const result = assessor.assessByPressure(800, 400);
    expect(result.success).toBe(true);
    expect(result.separationScore).toBeCloseTo(0.5, 1);
    expect(result.kernelIntact).toBe(true);
  });

  test('压力法: 压降不足判定为失败', () => {
    const result = assessor.assessByPressure(800, 780);
    expect(result.success).toBe(false);
    expect(result.separationScore).toBe(0.1);
    expect(result.reason).toContain('not cracked');
  });

  test('压力法: 压降过大判定为粉碎', () => {
    const result = assessor.assessByPressure(800, 50);
    expect(result.success).toBe(false);
    expect(result.kernelIntact).toBe(false);
    expect(result.reason).toContain('crushed');
  });

  test('压力法: 边界值 (刚好10%降幅)', () => {
    // 10% 降幅刚好在边界上 (dropRatio >= 0.1 视为成功)
    const result = assessor.assessByPressure(1000, 900);
    expect(result.success).toBe(true);
    expect(result.separationScore).toBeCloseTo(0.1, 1);
  });

  test('图像法: 完全相同的图像差异为0', async () => {
    const width = 100;
    const height = 100;
    const size = width * height * 3;
    const buffer = Buffer.alloc(size, 128);

    const result = await assessor.assess(buffer, buffer, width, height);
    expect(result.separationScore).toBeLessThan(0.2);
    expect(result.success).toBe(false);
  });

  test('图像法: 明显差异判定为成功', async () => {
    const width = 100;
    const height = 100;
    const size = width * height * 3;

    const before = Buffer.alloc(size, 100);
    const after = Buffer.alloc(size, 150); // 明显变亮

    const result = await assessor.assess(before, after, width, height);
    expect(result.separationScore).toBeGreaterThan(0.1);
  });
});
