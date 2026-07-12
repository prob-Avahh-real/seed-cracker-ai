import * as path from 'path';
import * as fs from 'fs';

/**
 * 深层 Partial 类型
 */
type DeepPartial<T> = T extends object ? {
  [P in keyof T]?: DeepPartial<T[P]>;
} : T;

/**
 * 嗑瓜子神器全局配置
 */
export interface AppConfig {
  /** 硬件配置 */
  hardware: {
    /** 串口路径 (macOS: /dev/tty.usb*, Linux: /dev/ttyUSB*, Windows: COM3) */
    serialPath: string;
    /** 串口波特率 */
    baudRate: number;
    /** 开壳舵机角度 (0-180) */
    crackServoAngle: number;
    /** 推料舵机角度 */
    feedServoAngle: number;
    /** 开壳压力阈值 (ADC 值, 0-1023) */
    pressureThreshold: number;
    /** 舵机动作间隔 (ms) */
    servoDelay: number;
  };

  /** 视觉配置 */
  vision: {
    /** 摄像头设备ID (默认 0 为内置摄像头) */
    cameraDevice: string;
    /** 图像宽度 */
    width: number;
    /** 图像高度 */
    height: number;
    /** 检测置信度阈值 (0-1) */
    confidenceThreshold: number;
    /** 模型路径 */
    modelPath: string;
  };

  /** AI 控制配置 */
  ai: {
    /** 最大重试次数 */
    maxRetries: number;
    /** 每颗瓜子处理超时 (ms) */
    seedTimeout: number;
    /** 两轮瓜子间隔 (ms) */
    seedInterval: number;
    /** 是否启用质量检测 */
    enableQualityCheck: boolean;
    /** 壳仁分离度阈值 (0-1) */
    separationThreshold: number;
  };

  /** Web 服务配置 */
  server: {
    /** 监听端口 */
    port: number;
    /** 是否启用 WebSocket */
    enableWebSocket: boolean;
    /** CORS 允许的来源 */
    corsOrigin: string;
  };

  /** 模型路径 */
  modelPath: string;
}

const defaultConfig: AppConfig = {
  hardware: {
    serialPath: process.platform === 'darwin' ? '/dev/tty.usbmodem*' : '/dev/ttyUSB0',
    baudRate: 115200,
    crackServoAngle: 45,
    feedServoAngle: 90,
    pressureThreshold: 600,
    servoDelay: 500,
  },
  vision: {
    cameraDevice: '0',
    width: 640,
    height: 480,
    confidenceThreshold: 0.7,
    modelPath: './models/orientation-model',
  },
  ai: {
    maxRetries: 3,
    seedTimeout: 5000,
    seedInterval: 200,
    enableQualityCheck: true,
    separationThreshold: 0.8,
  },
  server: {
    port: 3000,
    enableWebSocket: true,
    corsOrigin: '*',
  },
  modelPath: './models/orientation-model',
};

let config: AppConfig = { ...defaultConfig };

/**
 * 加载配置文件 (JSON 格式)，与默认配置合并
 */
export function loadConfig(configPath?: string): AppConfig {
  const resolvedPath = configPath || path.join(process.cwd(), 'config.json');

  if (fs.existsSync(resolvedPath)) {
    try {
      const raw = fs.readFileSync(resolvedPath, 'utf-8');
      const userConfig = JSON.parse(raw);
      config = deepMerge(defaultConfig, userConfig);
      return config;
    } catch (err) {
      console.warn(`Warning: failed to parse config at ${resolvedPath}, using defaults.`, err);
    }
  }

  return config;
}

/**
 * 获取当前配置
 */
export function getConfig(): AppConfig {
  return config;
}

/**
 * 更新运行时配置
 */
export function updateConfig(partial: DeepPartial<AppConfig>): AppConfig {
  config = deepMerge(config, partial as any);
  return config;
}

function deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
  const result = { ...target };
  for (const key of Object.keys(source) as (keyof T)[]) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(result[key] as any, source[key] as any);
    } else {
      result[key] = source[key] as any;
    }
  }
  return result;
}
