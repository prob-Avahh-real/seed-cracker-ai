/**
 * 配置模块单元测试
 */

import { loadConfig, getConfig, updateConfig, AppConfig } from '../src/config';
import * as fs from 'fs';
import * as path from 'path';

describe('Config', () => {
  test('默认配置包含所有必要字段', () => {
    const config = getConfig();
    expect(config.hardware).toBeDefined();
    expect(config.hardware.serialPath).toBeDefined();
    expect(config.hardware.baudRate).toBe(115200);
    expect(config.vision).toBeDefined();
    expect(config.vision.width).toBe(640);
    expect(config.vision.height).toBe(480);
    expect(config.ai).toBeDefined();
    expect(config.ai.maxRetries).toBe(3);
    expect(config.server).toBeDefined();
    expect(config.server.port).toBe(3000);
  });

  test('updateConfig 合并部分配置', () => {
    updateConfig({ ai: { maxRetries: 5 } });
    expect(getConfig().ai.maxRetries).toBe(5);
    // 其他字段不变
    expect(getConfig().server.port).toBe(3000);

    // 恢复
    updateConfig({ ai: { maxRetries: 3 } });
  });

  test('loadConfig 加载无效文件不抛异常', () => {
    // 不存在的文件 -> 使用默认配置
    const config = loadConfig('/nonexistent/path/config.json');
    expect(config).toBeDefined();
    expect(config.server.port).toBe(3000);
  });

  test('deepMerge 嵌套合并', () => {
    updateConfig({
      hardware: { crackServoAngle: 60 },
      ai: { maxRetries: 2, enableQualityCheck: false },
    });
    const config = getConfig();
    expect(config.hardware.crackServoAngle).toBe(60);
    expect(config.hardware.baudRate).toBe(115200); // 未改
    expect(config.ai.maxRetries).toBe(2);
    expect(config.ai.enableQualityCheck).toBe(false);

    // 恢复
    updateConfig({
      hardware: { crackServoAngle: 45 },
      ai: { maxRetries: 3, enableQualityCheck: true },
    });
  });
});
