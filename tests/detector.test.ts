/**
 * 种子检测器单元测试
 */

import { SeedDetector, DetectedSeed, BoundingBox } from '../src/vision/detector';

describe('SeedDetector', () => {
  let detector: SeedDetector;
  const width = 640;
  const height = 480;

  beforeEach(() => {
    detector = new SeedDetector();
  });

  test('空图像返回空数组', async () => {
    // 全黑图像
    const blackBuffer = Buffer.alloc(width * height * 3, 0);
    const seeds = await detector.detect(blackBuffer, width, height);
    expect(seeds).toEqual([]);
  });

  test('全白图像返回空数组 (无轮廓)', async () => {
    const whiteBuffer = Buffer.alloc(width * height * 3, 255);
    const seeds = await detector.detect(whiteBuffer, width, height);
    expect(seeds).toEqual([]);
  });

  test('detectPrimary 为空图像返回 null', async () => {
    const blackBuffer = Buffer.alloc(width * height * 3, 0);
    const seed = await detector.detectPrimary(blackBuffer, width, height);
    expect(seed).toBeNull();
  });

  test('简单圆形目标可被检测', async () => {
    // 在图像中央画一个白色圆 (模拟瓜子)
    const buffer = Buffer.alloc(width * height * 3, 30); // 深灰背景
    const cx = width / 2;
    const cy = height / 2;
    const radius = 40;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy < radius * radius) {
          const idx = (y * width + x) * 3;
          buffer[idx] = 200;     // R
          buffer[idx + 1] = 180; // G
          buffer[idx + 2] = 150; // B
        }
      }
    }

    const seeds = await detector.detect(buffer, width, height);
    expect(seeds.length).toBeGreaterThan(0);
  });

  test('检测结果的属性完整性', async () => {
    const buffer = Buffer.alloc(width * height * 3, 30);
    const cx = 100;
    const cy = 100;
    const radius = 30;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy < radius * radius) {
          const idx = (y * width + x) * 3;
          buffer[idx] = 200;
          buffer[idx + 1] = 180;
          buffer[idx + 2] = 150;
        }
      }
    }

    const seeds = await detector.detect(buffer, width, height);
    if (seeds.length > 0) {
      const seed = seeds[0];
      expect(seed.id).toBe(0);
      expect(seed.bbox.x).toBeGreaterThanOrEqual(0);
      expect(seed.bbox.y).toBeGreaterThanOrEqual(0);
      expect(seed.bbox.width).toBeGreaterThan(0);
      expect(seed.bbox.height).toBeGreaterThan(0);
      expect(seed.centerX).toBeGreaterThan(0);
      expect(seed.centerY).toBeGreaterThan(0);
      expect(seed.area).toBeGreaterThan(0);
      expect(seed.aspectRatio).toBeGreaterThan(0);
    }
  });
});
